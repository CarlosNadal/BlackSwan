#!/bin/bash
# stop-service.sh - Detener el servicio Black Swan WiFi

echo "🛑 Deteniendo Black Swan WiFi Recon Service..."

if systemctl is-active --quiet blackswan-wifi; then
    sudo systemctl stop blackswan-wifi
    echo "✅ Servicio detenido"
else
    echo "ℹ️  El servicio no está corriendo"
fi

# También limpiar archivos temporales
echo "🧹 Limpiando archivos temporales..."
for p in /tmp/airodump_capture*; do
    if [ -e "$p" ]; then
        rm -f "$p"
        echo "🗑️  Eliminado: $p"
    fi
done

echo "✅ Listo"