#!/bin/bash
# start.sh - Ejecución manual de Black Swan WiFi Recon
# Uso: sudo ./start.sh

set -e  # Detener en caso de error

cd "$(dirname "$0")"

echo "🚀 Black Swan WiFi Recon - Ejecución Manual"
echo "==========================================="

# Verificar que estamos como root
if [ "$EUID" -ne 0 ]; then
    echo "❌ Este script requiere permisos de root (sudo)"
    echo "💡 Ejecuta con: sudo ./start.sh"
    exit 1
fi

# Verificar que el entorno virtual existe
if [ ! -d "venv" ]; then
    echo "❌ Entorno virtual no encontrado"
    echo "💡 Ejecuta primero: sudo ./deploy.sh"
    exit 1
fi

# Verificar dependencias del sistema
echo ""
echo "🔍 Verificando dependencias..."
if ! command -v airodump-ng &> /dev/null; then
    echo "❌ airodump-ng no encontrado"
    echo "💡 Instala con: sudo apt install aircrack-ng"
    exit 1
fi
echo "✅ airodump-ng encontrado"

if ! command -v python3 &> /dev/null; then
    echo "❌ python3 no encontrado"
    exit 1
fi
echo "✅ python3 encontrado"

# Verificar dependencias Python
echo "🐍 Verificando dependencias Python..."
source venv/bin/activate
if ! python3 -c "import flask, flask_socketio, flask_cors" &> /dev/null; then
    echo "❌ Faltan dependencias Python"
    echo "💡 Instala con: pip install flask flask-socketio flask-cors"
    exit 1
fi
echo "✅ Dependencias Python OK"

# Detener el servicio si está corriendo (para evitar conflictos)
echo ""
echo "🛑 Verificando servicio..."
if systemctl is-active --quiet blackswan-wifi; then
    echo "⚠️  El servicio está corriendo. Deteniéndolo..."
    sudo systemctl stop blackswan-wifi
    echo "✅ Servicio detenido"
fi

# Limpiar archivos temporales previos
echo ""
echo "🧹 Limpiando archivos temporales..."
for p in /tmp/airodump_capture*; do
    if [ -e "$p" ]; then
        rm -f "$p"
        echo "🗑️  Eliminado: $p"
    fi
done

# Información de ejecución
echo ""
echo "🎯 Iniciando Black Swan WiFi Recon..."
echo "📡 Interface: wlan0"
echo "🌐 Puerto: 8000"
echo "💻 Modo: Ejecución manual"
echo ""
echo "📍 URLs de acceso:"
echo "   WebSocket: http://localhost:8000"
echo "   HTTP API:  http://localhost:8000/scan"
echo ""
echo "🛑 Para detener: Ctrl + C"
echo "==========================================="

# Ejecutar la aplicación
source venv/bin/activate
exec python3 main.py