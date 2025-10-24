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
    apt install -y python3 python3-venv
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

# Instalar/actualizar dependencias Python
echo "📥 Instalando dependencias Python..."
pip install --upgrade pip
pip install flask flask-socketio flask-cors

echo "✅ Dependencias Python instaladas"

# Paso 3: Crear servicio systemd
echo ""
echo "⚙️ Paso 3: Configurando servicio systemd..."

SERVICE_FILE="/etc/systemd/system/blackswan-wifi.service"
CURRENT_DIR=$(pwd)

# Crear el archivo de servicio
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

# Mover el archivo a su ubicación final
mv /tmp/blackswan-wifi.service $SERVICE_FILE
chmod 644 $SERVICE_FILE

echo "✅ Servicio creado: $SERVICE_FILE"

# Paso 4: Configurar permisos y recargar systemd
echo ""
echo "🔐 Paso 4: Configurando permisos..."
sudo systemctl daemon-reload
echo "✅ Systemd recargado"

# Paso 5: Probar que el código funciona
echo ""
echo "🧪 Paso 5: Probando instalación..."
if ! source venv/bin/activate && python3 -c "import flask, flask_socketio, flask_cors; print('✅ Importaciones OK')"; then
    echo "❌ Error en las dependencias Python"
    exit 1
fi

# Paso 6: Iniciar y habilitar el servicio
echo ""
echo "⚡ Paso 6: Iniciando servicio..."
sudo systemctl enable blackswan-wifi
echo "✅ Servicio habilitado (inicio automático)"

sudo systemctl start blackswan-wifi
echo "✅ Servicio iniciado"

# Esperar un poco y verificar estado
sleep 2
echo ""
echo "📊 Verificando estado del servicio..."
SERVICE_STATUS=$(sudo systemctl is-active blackswan-wifi)

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
echo "📝 Logs del servicio:"
sudo journalctl -u blackswan-wifi -n 5 --no-pager
echo ""
echo "💡 Para más logs: sudo journalctl -u blackswan-wifi -f"