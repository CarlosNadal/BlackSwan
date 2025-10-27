#!/bin/bash
# deploy.sh - Despliegue completo Black Swan WiFi Recon
# Uso:
#   sudo ./deploy.sh --prod  -> despliegue seguro (usuario dedicado, systemd)
#   ./deploy.sh --dev        -> despliegue para desarrollo/lab (sin usuario dedicado, sin chown)
set -euo pipefail

cd "$(dirname "$0")"

MODE="prod"
if [[ "${1:-}" == "--dev" ]]; then
    MODE="dev"
fi

echo "🚀 Black Swan WiFi Recon - Despliegue ($MODE mode)"
echo "================================================"

CURRENT_DIR=$(pwd)
SERVICE_FILE="/etc/systemd/system/blackswan-wifi.service"
LOG_DIR="/var/log/blackswan"
ENV_FILE="/etc/default/blackswan-wifi"

INTERFACE="wlan0"
PORT="8000"

# =======================
# DEV mode (labs / debug)
# =======================
if [[ "$MODE" == "dev" ]]; then
    echo "🔧 Modo desarrollo / laboratorio"
    # venv
    if [ ! -d "venv" ]; then
        echo "📦 Creando venv..."
        python3 -m venv venv
    fi
    source venv/bin/activate
    pip install --upgrade pip setuptools wheel greenlet
    pip install flask flask-socketio flask-cors eventlet
    echo "✅ venv listo"

    echo "🐍 Para ejecutar: source venv/bin/activate && python3 main.py"
    echo "⚠️ No se creó usuario dedicado ni systemd"
    exit 0
fi

# =======================
# PROD mode
# =======================
# Requiere root
if [ "$EUID" -ne 0 ]; then
    echo "❌ Este script requiere sudo/root"
    exit 1
fi

# Preguntar nombre de usuario dedicado
read -r -p "Nombre del usuario de servicio [black-swan]: " SERVICE_USER
SERVICE_USER=${SERVICE_USER:-black-swan}
echo "👤 Usuario de servicio: $SERVICE_USER"

# Crear usuario si no existe
if ! id "$SERVICE_USER" &>/dev/null; then
    useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
    echo "✅ Usuario creado"
fi

# Dependencias del sistema
echo "📦 Verificando dependencias..."
for pkg in airodump-ng python3 python3-venv python3-pip; do
    if ! command -v "$pkg" &>/dev/null; then
        echo "❌ $pkg no encontrado, instalando..."
        apt update && apt install -y "$pkg"
    else
        echo "✅ $pkg encontrado"
    fi
done

# venv y permisos mínimos
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi
chown -R "$SERVICE_USER":"$SERVICE_USER" venv
find venv -type d -exec chmod 750 {} \;
find venv -type f -exec chmod 640 {} \;
chmod 750 venv/bin/{activate,python3,pip} || true

# instalar deps python
sudo -u "$SERVICE_USER" venv/bin/pip install --upgrade pip setuptools wheel greenlet
sudo -u "$SERVICE_USER" venv/bin/pip install flask flask-socketio flask-cors eventlet

# permisos mínimos en scripts
EXEC_FILES=("main.py" "start.sh" "stopservice.sh" "restart.sh")
for f in "${EXEC_FILES[@]}"; do
    if [ -f "$f" ]; then
        chown "$SERVICE_USER":"$SERVICE_USER" "$f"
        chmod 750 "$f"
    fi
done

# logs
mkdir -p "$LOG_DIR"
chown "$SERVICE_USER":"$SERVICE_USER" "$LOG_DIR"
chmod 750 "$LOG_DIR"

# EnvironmentFile
echo "INTERFACE=$INTERFACE" > "$ENV_FILE"
echo "PORT=$PORT" >> "$ENV_FILE"
chmod 644 "$ENV_FILE"

# Crear service systemd
cat > /tmp/blackswan-wifi.service << EOF
[Unit]
Description=Black Swan WiFi Reconnaissance
After=network.target
Wants=network.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$CURRENT_DIR
ExecStart=$CURRENT_DIR/venv/bin/python3 $CURRENT_DIR/main.py
Restart=on-failure
RestartSec=5
StartLimitBurst=5
StartLimitIntervalSec=60
EnvironmentFile=$ENV_FILE
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=$CURRENT_DIR $LOG_DIR /tmp
LimitNOFILE=65536
TasksMax=200

[Install]
WantedBy=multi-user.target
EOF

mv /tmp/blackswan-wifi.service "$SERVICE_FILE"
chmod 644 "$SERVICE_FILE"

systemctl daemon-reload
systemctl enable --now blackswan-wifi
systemctl restart blackswan-wifi

sleep 2
SERVICE_STATUS=$(systemctl is-active blackswan-wifi)
if [ "$SERVICE_STATUS" = "active" ]; then
    echo "✅ Servicio corriendo (usuario: $SERVICE_USER)"
else
    echo "❌ Servicio no arrancó, revisa logs con sudo journalctl -u blackswan-wifi -n 50"
fi

echo "🎉 Despliegue completado"
echo "⚠️ Solo el usuario '$SERVICE_USER' (y root) puede ejecutar main.py y scripts listados"
echo "📋 Comandos útiles:"
echo " sudo systemctl status blackswan-wifi"
echo " sudo journalctl -u blackswan-wifi -f"
