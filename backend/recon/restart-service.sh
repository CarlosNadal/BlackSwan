#!/bin/bash
# restart-service.sh - Reiniciar el servicio Black Swan WiFi

echo "🔄 Reiniciando Black Swan WiFi Recon Service..."

sudo systemctl restart blackswan-wifi
sleep 2

if systemctl is-active --quiet blackswan-wifi; then
    echo "✅ Servicio reiniciado correctamente"
    echo ""
    echo "📊 Estado:"
    sudo systemctl status blackswan-wifi --no-pager -l
else
    echo "❌ Error al reiniciar el servicio"
    echo "💡 Revisa los logs: sudo journalctl -u blackswan-wifi -n 20"
fi