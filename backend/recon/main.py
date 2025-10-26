#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Black Swan - main.py (Sistema Inteligente de Alertas)
Backend Flask + Flask-SocketIO con detección avanzada de anomalías.
"""

# ---------------- eventlet monkey-patch ABSOLUTAMENTE PRIMERO ----------------
import sys
import os

try:
    import eventlet
    eventlet.monkey_patch(all=True)
except Exception as e:
    print("❌ eventlet no disponible o fallo al monkey_patch:", e)
    print("💡 Instálalo: pip install eventlet")
    sys.exit(1)

import time
import signal
import traceback
import subprocess
from pathlib import Path
import json
import logging
from collections import deque

from flask import Flask, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit

# ---------------- Config ----------------
INTERFACE = os.environ.get("INTERFACE", "wlan0")
PORT = int(os.environ.get("PORT", "8000"))
CSV_PREFIX = "/tmp/airodump_capture"
QUIET = os.environ.get("QUIET", "0") == "1"

# ---------------- Logging ----------------
logger = logging.getLogger("blackswan")
logger.setLevel(logging.WARNING if QUIET else logging.INFO)
handler = logging.StreamHandler(sys.stdout)
formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", "%H:%M:%S")
handler.setFormatter(formatter)
logger.handlers = []
logger.addHandler(handler)

for lib in ("engineio", "socketio", "werkzeug"):
    logging.getLogger(lib).setLevel(logging.WARNING)

# ---------------- App ----------------
app = Flask(__name__)
CORS(app)

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    ping_timeout=60,
    ping_interval=25,
    async_mode="eventlet",
    logger=False,
    engineio_logger=False
)

# ---------------- Globals ----------------
proc = None
clients_count = 0
scanner_running = True
last_ap_data = {}  # Último valor de paquetes por AP
ap_baselines = {}  # Baseline de tráfico normal por AP (media móvil)
ap_alert_history = {}  # Historial de alertas para evitar spam

# ---------------- util: encontrar CSV ----------------
def find_csv():
    try:
        candidates = sorted(Path("/tmp").glob("airodump_capture-*.csv"),
                          key=lambda p: p.stat().st_mtime if p.exists() else 0,
                          reverse=True)
        return candidates[0] if candidates else None
    except Exception as e:
        logger.debug(f"[find_csv] Error: {e}")
        return None

# ---------------- helpers estadísticos ----------------
def median(values):
    if not values:
        return 0
    s = sorted(values)
    n = len(values)
    mid = n // 2
    if n % 2 == 0:
        return (s[mid - 1] + s[mid]) / 2
    else:
        return s[mid]

# ---------------- CSV parser ----------------
def parse_airodump_csv(csv_path: Path):
    import csv
    aps_map = {}
    try:
        if not csv_path.exists():
            return []
        text = csv_path.read_text(encoding="utf-8", errors="ignore").splitlines()
        if not text:
            return []

        # Localizar "Station MAC"
        station_start_idx = None
        for i, line in enumerate(text):
            if line.strip().lower().startswith("station mac"):
                station_start_idx = i
                break

        ap_lines = text[:station_start_idx] if station_start_idx is not None else text[:]
        station_lines = text[station_start_idx:] if station_start_idx is not None else []

        ap_reader = csv.reader(ap_lines)
        ap_rows = [[c.strip() for c in row] for row in ap_reader if any(col.strip() for col in row)]

        ap_header_idx = None
        for idx, row in enumerate(ap_rows):
            if len(row) > 0 and row[0].lower().startswith("bssid"):
                ap_header_idx = idx
                break

        ap_data_rows = ap_rows[ap_header_idx+1:] if ap_header_idx is not None else ap_rows
        headers = ap_rows[ap_header_idx] if ap_header_idx is not None else []
        header_map = {h.strip().lower(): i for i, h in enumerate(headers)}

        def safe_get(row, idx, default=""):
            try:
                return row[idx].strip()
            except Exception:
                return default

        def extract_data_field(row):
            candidates = ["data", "# data", "packets", "# packets", "# beacons", "beacons"]
            for name in candidates:
                if name in header_map:
                    val = safe_get(row, header_map.get(name))
                    if val:
                        digits = ''.join(ch for ch in val if (ch.isdigit() or ch == '-'))
                        try:
                            return int(digits) if digits else 0
                        except:
                            continue
            for idx_try in (9, 8, 6, 5):
                if idx_try < len(row):
                    v = row[idx_try]
                    digits = ''.join(ch for ch in v if (ch.isdigit() or ch == '-'))
                    try:
                        return int(digits) if digits else 0
                    except:
                        continue
            return 0

        # Parse AP data
        for row in ap_data_rows:
            if not row or len(row) < 2:
                continue
            bssid = safe_get(row, header_map.get("bssid", 0), "")
            if not bssid or bssid.lower() == "station mac":
                continue
            essid = safe_get(row, header_map.get("essid", header_map.get("ssid", 13)), "")
            channel = safe_get(row, header_map.get("channel", 3), "")
            privacy = safe_get(row, header_map.get("privacy", 5), "")
            power_str = safe_get(row, header_map.get("power", 8), "")
            data_val = extract_data_field(row)
            try:
                power = int(power_str)
            except:
                try:
                    power = int(''.join(ch for ch in power_str if (ch.isdigit() or ch == '-')))
                except:
                    power = -100

            ap_obj = {
                "bssid": bssid,
                "essid": essid if essid else "Oculto",
                "channel": channel,
                "privacy": privacy,
                "power": power,
                "data": data_val,
                "clients": [],
                "clients_count_ap": 0,
                "data_flag": "normal",
                "possible_evil_twin": False
            }
            aps_map[bssid.lower()] = ap_obj

        # Parse stations
        if station_lines:
            station_reader = csv.reader(station_lines)
            station_rows = [[c.strip() for c in row] for row in station_reader if any(col.strip() for col in row)]
            st_header_idx = None
            for idx, row in enumerate(station_rows):
                if len(row) > 0 and row[0].lower().startswith("station mac"):
                    st_header_idx = idx
                    break
            st_data_rows = station_rows[st_header_idx+1:] if st_header_idx is not None else station_rows
            if st_header_idx is not None:
                st_headers = station_rows[st_header_idx]
                st_map = {h.strip().lower(): i for i, h in enumerate(st_headers)}
                for srow in st_data_rows:
                    if not srow or len(srow) < 1:
                        continue
                    st_mac = safe_get(srow, st_map.get("station mac", 0), "")
                    st_power_str = safe_get(srow, st_map.get("power", 3), "")
                    st_bssid = safe_get(srow, st_map.get("bssid", 5), "")
                    if not st_mac:
                        continue
                    try:
                        st_power = int(st_power_str)
                    except:
                        try:
                            st_power = int(''.join(ch for ch in st_power_str if (ch.isdigit() or ch == '-')))
                        except:
                            st_power = -100
                    if st_bssid and st_bssid.lower() in aps_map:
                        ap = aps_map[st_bssid.lower()]
                        if not any(c.get("mac", "").lower() == st_mac.lower() for c in ap["clients"]):
                            ap["clients"].append({"mac": st_mac, "power": st_power})

        aps = list(aps_map.values())
        aps.sort(key=lambda x: x.get("power", -100), reverse=True)

        # Detectar ESSIDs duplicados (possible evil twin)
        essid_counts = {}
        for ap in aps:
            ess = (ap.get("essid") or "").strip()
            if ess and ess.lower() != "oculto":
                essid_counts[ess.lower()] = essid_counts.get(ess.lower(), 0) + 1

        # Asignar flags basadas en heurística
        data_vals = [max(0, ap.get("data", 0)) for ap in aps]
        med = median(data_vals)
        if med <= 0:
            med = 1

        for ap in aps:
            val = max(0, ap.get("data", 0))
            if val > med * 10 and val > 1000:
                ap["data_flag"] = "high"
            elif val > med * 2 and val > 100:
                ap["data_flag"] = "suspicious"
            else:
                ap["data_flag"] = "normal"

            # marcar possible evil twin si el ESSID aparece >1
            ess = (ap.get("essid") or "").strip()
            if ess and ess.lower() != "oculto" and essid_counts.get(ess.lower(), 0) > 1:
                ap["possible_evil_twin"] = True

            ap["clients"].sort(key=lambda c: c.get("power", -100), reverse=True)
            ap["clients_count_ap"] = len(ap["clients"])

        return aps

    except Exception:
        logger.exception("[parser] Error parsing CSV")
        return []

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
        proc_local = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        logger.info(f"[scanner] airodump-ng lanzado como PID {proc_local.pid} en interfaz {INTERFACE}")
        return proc_local
    except FileNotFoundError:
        logger.error("[ERROR] airodump-ng no encontrado")
        sys.exit(1)
    except Exception:
        logger.exception("[ERROR] al lanzar airodump-ng")
        sys.exit(1)

# ---------------- Sistema Inteligente de Detección Evil Twin ----------------
def detect_evil_twin(aps):
    """Detección mejorada de Evil Twin que evita falsos positivos por bandas duales"""
    alerts = []
    
    # Agrupar APs por ESSID
    essid_groups = {}
    for ap in aps:
        essid = (ap.get("essid") or "").strip()
        if essid and essid.lower() != "oculto":
            if essid not in essid_groups:
                essid_groups[essid] = []
            essid_groups[essid].append(ap)
    
    # Analizar cada grupo de ESSID duplicado
    for essid, aps_list in essid_groups.items():
        if len(aps_list) <= 1:
            continue
            
        # CRITERIOS PARA EVITAR FALSOS POSITIVOS:
        
        # 1. Mismo canal = muy sospechoso (raro en bandas duales)
        channels = [ap.get("channel", "") for ap in aps_list]
        unique_channels = set(channels)
        
        # 2. Diferencia de potencia muy grande (inusual para mismo AP)
        powers = [ap.get("power", -100) for ap in aps_list]
        power_range = max(powers) - min(powers) if powers else 0
        
        # 3. Presencia de clientes conectados (más sospechoso si hay clientes en ambos)
        clients_counts = [len(ap.get("clients", [])) for ap in aps_list]
        total_clients = sum(clients_counts)
        
        # 4. Seguridad diferente (muy sospechoso)
        securities = [ap.get("privacy", "").lower() for ap in aps_list]
        unique_securities = set(securities)
        
        # INDICADORES DE EVIL TWIN (múltiples criterios)
        evil_twin_score = 0
        evil_twin_indicators = []
        
        # A. Mismo canal (+3 puntos)
        if len(unique_channels) < len(aps_list):
            evil_twin_score += 3
            evil_twin_indicators.append("Mismo canal")
        
        # B. Diferencia de seguridad (+2 puntos)
        if len(unique_securities) > 1:
            evil_twin_score += 2
            evil_twin_indicators.append("Seguridad diferente")
        
        # C. Diferencia de potencia extrema (+2 puntos)
        if power_range > 30:  # Más de 30 dBm de diferencia
            evil_twin_score += 2
            evil_twin_indicators.append(f"Potencia muy diferente ({power_range} dBm)")
        
        # D. Múltiples clientes conectados (+1 punto por cada AP con clientes)
        aps_with_clients = sum(1 for count in clients_counts if count > 0)
        if aps_with_clients > 1:
            evil_twin_score += aps_with_clients
            evil_twin_indicators.append(f"Múltiples APs con clientes ({aps_with_clients})")
        
        # E. Nombre genérico/sospechoso (+1 punto)
        suspicious_names = ["free wifi", "wifi gratis", "public wifi", "hotspot", "staff", "guest"]
        if any(name in essid.lower() for name in suspicious_names):
            evil_twin_score += 1
            evil_twin_indicators.append("Nombre sospechoso")
        
        # DECISIÓN BASADA EN PUNTUACIÓN
        bssids = [ap["bssid"] for ap in aps_list]
        
        # Evil Twin confirmado (alta probabilidad)
        if evil_twin_score >= 5:
            alert = {
                "type": "evil_twin_high",
                "message": f"🚨 EVIL TWIN CONFIRMADO: '{essid}' - {', '.join(evil_twin_indicators)}",
                "essid": essid,
                "bssids": bssids,
                "channels": list(unique_channels),
                "power_range": power_range,
                "severity": "critical",
                "confidence": "high",
                "indicators": evil_twin_indicators
            }
            alerts.append(alert)
            logger.warning(f"🚨 EVIL TWIN CONFIRMADO: {essid} - Score: {evil_twin_score}")
        
        # Evil Twin sospechoso (media probabilidad)
        elif evil_twin_score >= 3:
            alert = {
                "type": "evil_twin_suspicious", 
                "message": f"⚠️ POSIBLE EVIL TWIN: '{essid}' - {', '.join(evil_twin_indicators)}",
                "essid": essid,
                "bssids": bssids,
                "channels": list(unique_channels),
                "power_range": power_range,
                "severity": "medium",
                "confidence": "medium",
                "indicators": evil_twin_indicators
            }
            alerts.append(alert)
            logger.warning(f"⚠️ POSIBLE EVIL TWIN: {essid} - Score: {evil_twin_score}")
        
        # Bandas duales normales (baja probabilidad) - solo log, no alerta
        else:
            logger.info(f"📡 Bandas duales normales: '{essid}' en {len(aps_list)} BSSIDs (canales: {list(unique_channels)})")
    
    return alerts

# ---------------- Sistema Inteligente de Alertas (ACTUALIZADO) ----------------
def analyze_traffic_anomalies(ap, bssid):
    """Analiza el tráfico del AP y genera alertas inteligentes"""
    current_data = ap.get("data", 0)
    previous_data = last_ap_data.get(bssid, 0)
    delta = current_data - previous_data
    last_ap_data[bssid] = current_data
    ap["delta_data"] = max(0, delta)
    
    # Inicializar baseline si no existe
    if bssid not in ap_baselines:
        ap_baselines[bssid] = deque(maxlen=8)
    
    # Inicializar historial de alertas
    if bssid not in ap_alert_history:
        ap_alert_history[bssid] = {"last_alert": 0, "alert_count": 0}
    
    alerts = []
    baseline_avg = 0
    
    # Solo calcular baseline si tenemos suficiente historial
    if len(ap_baselines[bssid]) >= 3:
        baseline_avg = sum(ap_baselines[bssid]) / len(ap_baselines[bssid])
        ap["baseline"] = round(baseline_avg, 1)
    
    # Agregar delta actual al baseline (excepto si es cero)
    if ap["delta_data"] > 0:
        ap_baselines[bssid].append(ap["delta_data"])
    
    # LÓGICA DE DETECCIÓN DE TRÁFICO
    # 1. DETECCIÓN CRÍTICA
    if ap["delta_data"] > 8000:
        alert = {
            "type": "critical_traffic",
            "message": f"🚨 CRÍTICO: {ap['essid']} - Tráfico EXTREMO: {ap['delta_data']} pkt/30s",
            "bssid": ap['bssid'],
            "essid": ap['essid'],
            "data": ap['delta_data'],
            "severity": "critical"
        }
        alerts.append(alert)
        logger.warning(f"🚨 ALERTA CRÍTICA: {ap['bssid']} - {ap['delta_data']} paquetes")
    
    # 2. DETECCIÓN DE SPIKE
    elif (baseline_avg > 20 and 
          ap["delta_data"] > baseline_avg * 15 and 
          ap["delta_data"] > 500):
        alert = {
            "type": "traffic_spike", 
            "message": f"⚠️ SPIKE: {ap['essid']} - {ap['delta_data']} pkt (15x sobre normal: {baseline_avg:.0f})",
            "bssid": ap['bssid'],
            "essid": ap['essid'], 
            "data": ap['delta_data'],
            "baseline": round(baseline_avg, 1),
            "severity": "high"
        }
        alerts.append(alert)
        logger.warning(f"⚠️ ALERTA SPIKE: {ap['bssid']} - {ap['delta_data']} paquetes (baseline: {baseline_avg:.0f})")
    
    # 3. DETECCIÓN DE TRÁFICO ALTO
    elif ap["delta_data"] > 2000:
        alert = {
            "type": "high_traffic",
            "message": f"🔶 ALTO: {ap['essid']} - Tráfico elevado: {ap['delta_data']} pkt/30s",
            "bssid": ap['bssid'],
            "essid": ap['essid'],
            "data": ap['delta_data'],
            "severity": "medium"
        }
        alerts.append(alert)
        logger.info(f"🔶 ALERTA ALTA: {ap['bssid']} - {ap['delta_data']} paquetes")
    
    # 4. DETECCIÓN SOSPECHOSA
    elif (baseline_avg > 50 and 
          ap["delta_data"] > baseline_avg * 5 and 
          ap["delta_data"] > 300):
        alert = {
            "type": "suspicious_traffic",
            "message": f"🔸 SOSPECHOSO: {ap['essid']} - {ap['delta_data']} pkt (5x sobre normal)",
            "bssid": ap['bssid'],
            "essid": ap['essid'],
            "data": ap['delta_data'],
            "baseline": round(baseline_avg, 1),
            "severity": "low"
        }
        alerts.append(alert)
        logger.info(f"🔸 ALERTA SOSPECHOSA: {ap['bssid']} - {ap['delta_data']} paquetes")
    
    # Prevenir spam de alertas - máximo 1 alerta por minuto por AP
    current_time = time.time()
    if alerts and current_time - ap_alert_history[bssid]["last_alert"] < 60:
        # Solo mantener alertas críticas si hay spam
        alerts = [a for a in alerts if a["severity"] == "critical"]
    
    if alerts:
        ap_alert_history[bssid]["last_alert"] = current_time
        ap_alert_history[bssid]["alert_count"] += 1
    
    return alerts

# ---------------- Scanner loop (ACTUALIZADO) ----------------
def scanner_loop():
    global clients_count
    message_count = 0
    last_snapshot = None
    logger.info("[scanner] loop iniciado (intervalo 30s)")

    while scanner_running:
        try:
            csv_path = find_csv()
            alerts_total = []
            
            if csv_path:
                aps = parse_airodump_csv(csv_path)
                total_clients = sum(len(ap["clients"]) for ap in aps)

                # ---------- ANÁLISIS INTELIGENTE ----------
                
                # 1. Detección de Evil Twin (global, no por AP)
                evil_twin_alerts = detect_evil_twin(aps)
                alerts_total.extend(evil_twin_alerts)
                
                # 2. Detección de anomalías de tráfico (por AP)
                for ap in aps:
                    bssid = ap['bssid'].lower()
                    ap_alerts = analyze_traffic_anomalies(ap, bssid)
                    alerts_total.extend(ap_alerts)
                    ap["alerts"] = ap_alerts

                snapshot = json.dumps(aps, sort_keys=True)
                if snapshot != last_snapshot or message_count % 6 == 0:
                    payload = {
                        "aps": aps,
                        "timestamp": time.time(),
                        "total_networks": len(aps),
                        "total_clients": total_clients,
                        "ws_clients_connected": clients_count,
                        "message_id": message_count,
                        "status": "success" if len(aps) else "no_data",
                        "alerts": alerts_total,
                    }
                    socketio.emit('wifi_data', payload)
                    message_count += 1
                    last_snapshot = snapshot
                    
                    # Log resumen mejorado
                    if alerts_total:
                        evil_twin_count = sum(1 for a in alerts_total if "evil_twin" in a["type"])
                        critical_count = sum(1 for a in alerts_total if a.get("severity") == "critical")
                        logger.info(f"[scanner] Emit #{message_count} | APs={len(aps)} | Alerts={len(alerts_total)} (EvilTwin:{evil_twin_count}, Critical:{critical_count})")
                    else:
                        logger.info(f"[scanner] Emit #{message_count} | APs={len(aps)} | Clients={total_clients} | Sin alertas")
            else:
                # No CSV encontrado
                if message_count % 12 == 0:
                    payload = {
                        "aps": [],
                        "timestamp": time.time(),
                        "total_networks": 0,
                        "total_clients": 0,
                        "ws_clients_connected": clients_count,
                        "message_id": message_count,
                        "status": "no_csv",
                        "alerts": []
                    }
                    socketio.emit('wifi_data', payload)
                    logger.info("[scanner] No CSV encontrado, emit vacio")
                message_count += 1

            eventlet.sleep(30)

        except Exception:
            logger.exception("[scanner] Error inesperado en loop")
            eventlet.sleep(10)

# ---------------- SocketIO events ----------------
@socketio.on('connect')
def handle_connect():
    global clients_count
    clients_count += 1
    logger.info(f"[ws] ✅ Cliente conectado. Total: {clients_count}")
    emit('status', {'message': 'Conectado al escáner WiFi', 'clients': clients_count})

    csv_path = find_csv()
    if csv_path:
        aps = parse_airodump_csv(csv_path)
        alerts_total = []
        
        #  USAR DETECCIÓN INTELIGENTE EN LUGAR DE DETECCIÓN BÁSICA
        evil_twin_alerts = detect_evil_twin(aps)
        alerts_total.extend(evil_twin_alerts)
        
        # DETECCIÓN DE TRÁFICO TAMBIÉN
        for ap in aps:
            bssid = ap['bssid'].lower()
            ap_alerts = analyze_traffic_anomalies(ap, bssid)
            alerts_total.extend(ap_alerts)

        payload = {
            "aps": aps,
            "timestamp": time.time(),
            "total_networks": len(aps),
            "total_clients": sum(len(ap["clients"]) for ap in aps),
            "ws_clients_connected": clients_count,
            "status": "success" if len(aps) else "no_data",
            "alerts": alerts_total,
        }
        emit('wifi_data', payload)

@socketio.on('disconnect')
def handle_disconnect():
    global clients_count
    clients_count = max(0, clients_count - 1)
    logger.info(f"[ws] 🔌 Cliente desconectado. Total: {clients_count}")

@socketio.on('request_data')
def handle_request_data():
    csv_path = find_csv()
    if csv_path:
        aps = parse_airodump_csv(csv_path)
        alerts_total = []
        
        # USAR DETECCIÓN INTELIGENTE COMPLETA
        evil_twin_alerts = detect_evil_twin(aps)
        alerts_total.extend(evil_twin_alerts)
        
        for ap in aps:
            bssid = ap['bssid'].lower()
            ap_alerts = analyze_traffic_anomalies(ap, bssid)
            alerts_total.extend(ap_alerts)

        payload = {
            "aps": aps,
            "timestamp": time.time(),
            "total_networks": len(aps),
            "total_clients": sum(len(ap["clients"]) for ap in aps),
            "ws_clients_connected": clients_count,
            "status": "success" if len(aps) else "no_data",
            "alerts": alerts_total,
        }
        emit('wifi_data', payload)
    else:
        emit('wifi_data', {
            "aps": [],
            "timestamp": time.time(),
            "total_networks": 0,
            "total_clients": 0,
            "status": "no_csv",
            "alerts": []
        })

# ---------------- HTTP routes ----------------
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
        alerts_total = []
        
        # USAR DETECCIÓN INTELIGENTE COMPLETA
        evil_twin_alerts = detect_evil_twin(aps)
        alerts_total.extend(evil_twin_alerts)
        
        for ap in aps:
            bssid = ap['bssid'].lower()
            ap_alerts = analyze_traffic_anomalies(ap, bssid)
            alerts_total.extend(ap_alerts)

        return jsonify({
            "aps": aps,
            "timestamp": time.time(),
            "total_networks": len(aps),
            "total_clients": sum(len(ap["clients"]) for ap in aps),
            "alerts": alerts_total
        })
    return jsonify({"error": "No CSV file found"})

@app.route('/debug_csv')
def debug_csv():
    csv_path = find_csv()
    if not csv_path:
        return jsonify({"error": "No CSV file found", "path": None}), 404
    try:
        text = csv_path.read_text(encoding="utf-8", errors="ignore")
        preview = text.splitlines()[:200]
        return jsonify({
            "path": str(csv_path),
            "size": csv_path.stat().st_size,
            "preview": preview
        })
    except Exception:
        logger.exception("failed to read csv")
        return jsonify({"error": "failed to read csv", "exc": "see logs"}), 500

# ---------------- cleanup ----------------
def cleanup():
    logger.info("🛑 Limpieza iniciada...")
    global scanner_running
    scanner_running = False

    global proc
    if proc and proc.poll() is None:
        logger.info("🔪 Terminando airodump-ng...")
        try:
            proc.terminate()
            proc.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        except Exception:
            pass

    for p in Path("/tmp").glob("airodump_capture*"):
        try:
            p.unlink()
        except Exception:
            pass

def signal_handler(sig, frame):
    logger.info(f"📡 Señal recibida {sig}, limpiando...")
    cleanup()
    sys.exit(0)

# ---------------- main ----------------
if __name__ == "__main__":
    if os.geteuid() != 0:
        logger.error("❌ Ejecuta con: sudo python3 main.py")
        sys.exit(1)

    try:
        subprocess.run(["airodump-ng", "--help"], capture_output=True, timeout=2)
        logger.info("✅ airodump-ng encontrado")
    except Exception:
        logger.error("❌ airodump-ng no encontrado")
        sys.exit(1)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    logger.info("🚀 Iniciando Black Swan - Sistema Inteligente de Detección WiFi")
    logger.info(f"📡 Interface: {INTERFACE}")
    logger.info(f"🌐 Puerto: {PORT}")
    logger.info("=" * 50)

    try:
        logger.info("🎯 Iniciando airodump-ng...")
        proc = start_airodump_csv()

        # Esperar por CSV
        eventlet.sleep(3)

        csv_file = find_csv()
        if csv_file:
            logger.info(f"📄 Archivo CSV detectado: {csv_file}")
            test_aps = parse_airodump_csv(csv_file)
            logger.info(f"🔍 Test parsing: {len(test_aps)} APs encontrados (primer parseo)")
        else:
            logger.warning("⚠️ No se detectó archivo CSV inicial")

        socketio.start_background_task(scanner_loop)

        logger.info("✅ Sistema iniciado correctamente!")
        logger.info("🎯 Sistema de alertas inteligente ACTIVADO")
        logger.info("   - Detección por baseline adaptativo")
        logger.info("   - Prevención de spam de alertas") 
        logger.info("   - Múltiples niveles de severidad")
        logger.info(f"🔗 WebSocket disponible en: http://0.0.0.0:{PORT}")
        logger.info("👂 Esperando conexiones...")
        logger.info("-" * 50)

        socketio.run(app, host='0.0.0.0', port=PORT, debug=False, use_reloader=False)

    except KeyboardInterrupt:
        logger.info("\n🛑 Interrupción por teclado")
    except Exception:
        logger.exception("❌ Error crítico")
    finally:
        cleanup()
        logger.info("👋 Sistema terminado")