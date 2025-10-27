#!/bin/bash
# deploy.sh - Despliegue completo de Black Swan WiFi Recon
# Uso: sudo ./deploy.sh

set -e  # Detener en caso de error

cd "$(dirname "$0")"

echo "🚀 Black Swan WiFi Recon - Despliegue completo"
echo "=============================================="

# Verificar que estamos como root
if [ "$EUID" -ne 0 ]; then
    echo "❌ Este script requiere permisos de root (sudo)"
    echo "💡 Ejecuta con: sudo ./deploy.sh"
    exit 1
fi

# Paso 1: Verificar e instalar dependencias del sistema
echo ""
echo "📦 Paso 1: Verificando dependencias del sistema..."
if ! command -v airodump-ng &> /dev/null; then
    echo "❌ airodump-ng no encontrado"
    echo "💡 Instalando aircrack-ng..."
    apt update && apt install -y aircrack-ng
else
    echo "✅ airodump-ng encontrado"
fi

if ! command -v python3 &> /dev/null; then
    echo "❌ python3 no encontrado"
    echo "💡 Instalando python3..."
    apt install -y python3 python3-venv python3-pip
else
    echo "✅ python3 encontrado"
fi

# Paso 2: Configurar entorno virtual
echo ""
echo "🔧 Paso 2: Configurando entorno virtual..."
if [ ! -d "venv" ]; then
    echo "📦 Creando entorno virtual..."
    python3 -m venv venv
    echo "✅ Entorno virtual creado"
else
    echo "✅ Entorno virtual ya existe"
fi

# Activar entorno virtual
source venv/bin/activate

# Paso 3: Instalar/actualizar dependencias Python
echo ""
echo "📥 Instalando dependencias Python..."
pip install --upgrade pip setuptools wheel greenlet
pip install flask flask-socketio flask-cors eventlet

echo "✅ Dependencias Python instaladas correctamente"

# Paso 4: Crear servicio systemd
echo ""
echo "⚙️ Paso 4: Configurando servicio systemd..."

SERVICE_FILE="/etc/systemd/system/blackswan-wifi.service"
CURRENT_DIR=$(pwd)

cat > /tmp/blackswan-wifi.service << EOF
[Unit]
Description=Black Swan WiFi Reconnaissance
After=network.target
Wants=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$CURRENT_DIR
ExecStart=$CURRENT_DIR/venv/bin/python3 main.py
Restart=always
RestartSec=5
Environment=INTERFACE=wlan0
Environment=PORT=8000

# Seguridad
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=$CURRENT_DIR /tmp

[Install]
WantedBy=multi-user.target
EOF

mv /tmp/blackswan-wifi.service $SERVICE_FILE
chmod 644 $SERVICE_FILE

echo "✅ Servicio creado: $SERVICE_FILE"

# Paso 5: Configurar permisos y recargar systemd
echo ""
echo "🔐 Paso 5: Configurando permisos..."
systemctl daemon-reload
echo "✅ Systemd recargado"

# Paso 6: Verificar dependencias antes de iniciar
echo ""
echo "🧪 Paso 6: Verificando importaciones..."
if ! python3 - << 'EOF'
try:
    import flask, flask_socketio, flask_cors, eventlet
    print("✅ Importaciones OK")
except Exception as e:
    print("❌ Error:", e)
    exit(1)
EOF
then
    echo "❌ Error en dependencias Python"
    exit 1
fi

# Paso 7: Iniciar y habilitar el servicio
echo ""
echo "⚡ Paso 7: Iniciando servicio..."
systemctl enable blackswan-wifi
systemctl restart blackswan-wifi
sleep 3

# Paso 8: Verificar estado del servicio
echo ""
echo "📊 Verificando estado del servicio..."
SERVICE_STATUS=$(systemctl is-active blackswan-wifi)

if [ "$SERVICE_STATUS" = "active" ]; then
    echo "✅ Servicio ejecutándose correctamente"
else
    echo "❌ El servicio no se pudo iniciar"
    echo "💡 Revisa los logs con: sudo journalctl -u blackswan-wifi -n 20"
    exit 1
fi

# Mostrar información final
echo ""
echo "🎉 ¡Despliegue completado exitosamente!"
echo "======================================="
echo ""
echo "📋 Comandos de gestión:"
echo "   sudo systemctl status blackswan-wifi    # Ver estado del servicio"
echo "   sudo journalctl -u blackswan-wifi -f    # Ver logs en tiempo real"
echo "   sudo systemctl stop blackswan-wifi      # Detener servicio"
echo "   sudo systemctl restart blackswan-wifi   # Reiniciar servicio"
echo "   sudo systemctl disable blackswan-wifi   # Deshabilitar inicio automático"
echo ""
echo "🌐 URLs de acceso:"
echo "   WebSocket: http://$(hostname -I | awk '{print $1}'):8000"
echo "   HTTP API:  http://$(hostname -I | awk '{print $1}'):8000/scan"
echo ""
echo "📝 Últimos logs del servicio:"
journalctl -u blackswan-wifi -n 5 --no-pager
echo ""
echo "💡 Para más logs: sudo journalctl -u blackswan-wifi -f"
