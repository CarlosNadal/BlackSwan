#!/bin/bash
# uninstall.sh - Remueve Black Swan WiFi Recon

echo "🗑️  Desinstalando Black Swan WiFi Recon..."

# Detener y deshabilitar servicio
sudo systemctl stop blackswan-wifi 2>/dev/null || true
sudo systemctl disable blackswan-wifi 2>/dev/null || true
sudo systemctl daemon-reload

# Remover archivo de servicio
sudo rm -f /etc/systemd/system/blackswan-wifi.service

# Opcional: remover entorno virtual (comenta si quieres mantenerlo)
# rm -rf venv

echo "✅ Desinstalación completada"
echo "💡 El directorio con el código se mantiene por si quieres reinstalar"