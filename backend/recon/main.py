#!/usr/bin/env python3
import csv
import json
import subprocess
from pathlib import Path
import os
import time
import signal
import sys
import traceback
import threading
from flask import Flask, request, jsonify  # ✅ Añadir request aquí
from flask_socketio import SocketIO, emit
from flask_cors import CORS

INTERFACE = os.environ.get("INTERFACE", "wlan0")
PORT = int(os.environ.get("PORT", "8000"))
CSV_PREFIX = "/tmp/airodump_capture"

# Configurar Flask y SocketIO
app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*", ping_timeout=60, ping_interval=25)

# Variables globales
proc = None
clients_count = 0
scanner_running = True

# ---------------- airodump launcher ----------------
def start_airodump_csv():
    for p in Path("/tmp").glob("airodump_capture*"):
        try:
            p.unlink()
        except Exception:
            pass

    cmd = [
        "airodump-ng",
        "--write-interval", "1",
        "--output-format", "csv",
        "-w", CSV_PREFIX,
        INTERFACE
    ]
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f"[scanner] airodump-ng lanzado como PID {proc.pid} en interfaz {INTERFACE}")
        return proc
    except FileNotFoundError:
        print("[ERROR] airodump-ng no encontrado")
        sys.exit(1)
    except Exception as e:
        print(f"[ERROR] al lanzar airodump-ng: {e}")
        sys.exit(1)

# ---------------- CSV parsing ----------------
def find_csv():
    candidates = sorted(Path("/tmp").glob("airodump_capture-*.csv"), key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0] if candidates else None

def _is_sep_row(row):
    if row is None:
        return False
    if len(row) == 0:
        return True
    return all((cell is None or str(cell).strip() == "") for cell in row)

def parse_airodump_csv(csv_file: Path):
    aps = []
    if not csv_file or not csv_file.exists():
        return aps

    try:
        with open(csv_file, newline="", encoding="utf-8", errors="ignore") as f:
            reader = csv.reader(f)
            rows = [r for r in reader]

        sep_idx = None
        for i, row in enumerate(rows):
            if _is_sep_row(row):
                sep_idx = i
                break

        ap_rows = rows[1:sep_idx] if sep_idx else rows[1:]
        client_rows = rows[sep_idx+2:] if sep_idx and (sep_idx + 2) < len(rows) else []

        for row in ap_rows:
            if len(row) < 9:
                continue
            bssid = row[0].strip()
            channel = row[3].strip() if len(row) > 3 else ""
            privacy = row[5].strip() if len(row) > 5 else ""
            power_str = row[8].strip() if len(row) > 8 else ""
            try:
                power = int(power_str)
            except:
                power = -100
            essid = row[13].strip() if len(row) > 13 else ""
            
            if power > -90:
                aps.append({
                    "bssid": bssid,
                    "essid": essid if essid else "Oculto",
                    "power": power,
                    "channel": channel,
                    "privacy": privacy,
                    "clients": []
                })

        for row in client_rows:
            if len(row) < 6:
                continue
            client_mac = row[0].strip()
            power_str = row[3].strip() if len(row) > 3 else ""
            try:
                power = int(power_str)
            except:
                power = -100
            ap_bssid = row[5].strip() if len(row) > 5 else ""
            
            for ap in aps:
                if ap["bssid"] == ap_bssid:
                    ap["clients"].append({"mac": client_mac, "power": power})
                    break
        
        aps.sort(key=lambda x: x["power"], reverse=True)
        for ap in aps:
            ap["clients"].sort(key=lambda x: x["power"], reverse=True)
            
    except Exception as e:
        print("[parser] Error parsing CSV:", e)
    
    return aps

# ---------------- Scanner Loop ----------------
def scanner_loop():
    print("[scanner] Iniciando loop de escaneo...")
    message_count = 0
    last_data = None
    
    while scanner_running:
        try:
            csv_path = find_csv()
            if csv_path:
                aps = parse_airodump_csv(csv_path)
                total_clients = sum(len(ap["clients"]) for ap in aps)
                
                current_data = json.dumps(aps, sort_keys=True)
                if current_data != last_data or message_count % 10 == 0:
                    payload = {
                        "aps": aps,
                        "timestamp": time.time(),
                        "total_networks": len(aps),
                        "total_clients": total_clients,
                        "message_id": message_count,
                        "status": "success"
                    }
                    
                    socketio.emit('wifi_data', payload)
                    message_count += 1
                    last_data = current_data
                    
                    if message_count % 10 == 1:
                        print(f"[scanner] Enviados {len(aps)} APs a {clients_count} clientes")
            
            time.sleep(10)
            
        except Exception as e:
            print(f"[scanner] Error: {e}")
            time.sleep(5)

# ---------------- SocketIO Events CORREGIDOS ----------------
@socketio.on('connect')
def handle_connect():
    """Manejador de conexión corregido"""
    global clients_count
    clients_count += 1
    print(f"[ws] ✅ Cliente conectado. Total: {clients_count}")
    emit('status', {'message': 'Conectado al escáner WiFi', 'clients': clients_count})

@socketio.on('disconnect')
def handle_disconnect():
    """Manejador de desconexión"""
    global clients_count
    clients_count = max(0, clients_count - 1)
    print(f"[ws] 🔌 Cliente desconectado. Total: {clients_count}")

@socketio.on('request_data')
def handle_request_data():
    """Enviar datos inmediatamente"""
    csv_path = find_csv()
    if csv_path:
        aps = parse_airodump_csv(csv_path)
        total_clients = sum(len(ap["clients"]) for ap in aps)
        
        payload = {
            "aps": aps,
            "timestamp": time.time(),
            "total_networks": len(aps),
            "total_clients": total_clients,
            "status": "success"
        }
        emit('wifi_data', payload)

# ---------------- HTTP Routes ----------------
@app.route('/')
def index():
    return jsonify({
        "status": "Black Swan WiFi Recon API", 
        "websocket": True,
        "clients_connected": clients_count,
        "timestamp": time.time()
    })

@app.route('/health')
def health():
    return jsonify({"status": "healthy", "timestamp": time.time()})

@app.route('/scan')
def immediate_scan():
    csv_path = find_csv()
    if csv_path:
        aps = parse_airodump_csv(csv_path)
        return jsonify({
            "aps": aps,
            "timestamp": time.time(),
            "total_networks": len(aps),
            "total_clients": sum(len(ap["clients"]) for ap in aps)
        })
    return jsonify({"error": "No CSV file found"})

# ---------------- Cleanup ----------------
def cleanup():
    print("\n🛑 Limpiando...")
    global scanner_running
    scanner_running = False
    
    if proc and proc.poll() is None:
        print("🔪 Terminando airodump-ng...")
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
    
    for p in Path("/tmp").glob("airodump_capture*"):
        try:
            p.unlink()
        except Exception:
            pass

def signal_handler(sig, frame):
    print(f"\n📡 Recibida señal {sig}")
    cleanup()
    sys.exit(0)

# ---------------- Main ----------------
if __name__ == "__main__":
    if os.geteuid() != 0:
        print("❌ Ejecuta con: sudo python3 main.py")
        sys.exit(1)
    
    try:
        subprocess.run(["airodump-ng", "--help"], capture_output=True, timeout=2)
        print("✅ airodump-ng encontrado")
    except:
        print("❌ airodump-ng no encontrado")
        sys.exit(1)
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    print("🚀 Iniciando Black Swan - WiFi Reconnaissance System")
    print(f"📡 Interface: {INTERFACE}")
    print(f"🌐 Puerto: {PORT}")
    print("=" * 50)
    
    try:
        print("🎯 Iniciando airodump-ng...")
        proc = start_airodump_csv()
        time.sleep(5)
        
        csv_file = find_csv()
        if csv_file:
            print(f"📄 Archivo CSV detectado: {csv_file}")
            test_aps = parse_airodump_csv(csv_file)
            print(f"🔍 Test parsing: {len(test_aps)} APs encontrados")
        
        scanner_thread = threading.Thread(target=scanner_loop, daemon=True)
        scanner_thread.start()
        
        print("✅ Sistema iniciado correctamente!")
        print(f"🔗 WebSocket disponible en: http://0.0.0.0:{PORT}")
        print("👂 Esperando conexiones...")
        print("-" * 50)
        
        socketio.run(app, host='0.0.0.0', port=PORT, debug=False, allow_unsafe_werkzeug=True)
        
    except KeyboardInterrupt:
        print("\n🛑 Interrupción por teclado")
    except Exception as e:
        print(f"❌ Error: {e}")
        traceback.print_exc()
    finally:
        cleanup()
        print("👋 Sistema terminado")