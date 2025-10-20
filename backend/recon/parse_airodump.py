import csv
import json

def parse_airodump_csv(csv_file_path):
    with open(csv_file_path, 'r', encoding='utf-8', errors='ignore') as f:
        # Leer todas las líneas y limpiar espacios
        lines = [line.strip() for line in f.readlines() if line.strip()]
    
    aps = []
    clients = []
    parsing_aps = True
    ap_header_found = False
    client_header_found = False

    for line in lines:
        # Saltar líneas vacías
        if not line:
            continue
            
        # Detectar sección de clientes
        if line.startswith('Station MAC'):
            parsing_aps = False
            client_header_found = True
            continue
            
        # Si es la sección de APs y encontramos el header de BSSID
        if parsing_aps and line.startswith('BSSID'):
            ap_header_found = True
            continue
            
        # Procesar APs
        if parsing_aps and ap_header_found and not line.startswith('BSSID'):
            # Dividir por comas y limpiar espacios
            row = [field.strip() for field in line.split(',')]
            
            # Verificar que tenga suficientes campos y sea una MAC válida
            if len(row) >= 14 and ':' in row[0] and len(row[0]) == 17:
                try:
                    bssid = row[0]
                    # La potencia está en la posición 8 (índice 8)
                    power_str = row[8].strip()
                    power = int(power_str) if power_str and power_str.lstrip('-').isdigit() else -100
                    channel = row[3]
                    privacy = row[5]
                    essid = row[13]
                    
                    aps.append({
                        "bssid": bssid,
                        "channel": channel,
                        "essid": essid,
                        "privacy": privacy,
                        "power": power,
                        "clients": []
                    })
                except (ValueError, IndexError) as e:
                    print(f"Error procesando AP: {row[0]} - {e}")
                    continue
                    
        # Procesar Clientes
        elif not parsing_aps and client_header_found and not line.startswith('Station MAC'):
            # Dividir por comas y limpiar espacios
            row = [field.strip() for field in line.split(',')]
            
            if len(row) >= 6 and row[0] and ':' in row[0]:
                try:
                    client_mac = row[0]
                    ap_mac = row[5]
                    power_str = row[3].strip()
                    power = int(power_str) if power_str and power_str.lstrip('-').isdigit() else -100
                    
                    # Solo procesar si el cliente está asociado a un AP (no "not associated")
                    if ap_mac and ap_mac != "(not associated)" and ':' in ap_mac:
                        # Buscar el AP y agregar el cliente
                        for ap in aps:
                            if ap["bssid"] == ap_mac:
                                ap["clients"].append({
                                    "mac": client_mac,
                                    "power": power
                                })
                                break
                except (ValueError, IndexError) as e:
                    print(f"Error procesando cliente: {row[0]} - {e}")
                    continue

    return {"aps": aps}

# === Uso ===
if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Uso: python3 parse_airodump.py archivo.csv")
        exit(1)

    resultado = parse_airodump_csv(sys.argv[1])
    
    # Mostrar estadísticas
    total_aps = len(resultado["aps"])
    total_clients = sum(len(ap["clients"]) for ap in resultado["aps"])
    
    print(f"📊 Estadísticas: {total_aps} APs encontrados, {total_clients} clientes asociados")
    
    # Mostrar algunos APs para verificación
    for i, ap in enumerate(resultado["aps"][:5]):
        print(f"AP {i+1}: {ap['essid']} ({ap['bssid']}) - {len(ap['clients'])} clientes")
    
    with open("recon_output.json", "w") as f:
        json.dump(resultado, f, indent=2)
    print("✅ JSON generado: recon_output.json")