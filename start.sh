#!/bin/bash
# start.sh - Levanta monitor (airmon-ng), frontend y backend.
# Uso: sudo ./start.sh

set -euo pipefail
cd "$(dirname "$0")"

### Config
BACKEND_DIR="backend/recon"
# Variantes comunes del directorio frontend (busca por estas)
POSSIBLE_FRONT_DIRS=("Frontend" "frontend" "UI" "ui" "frontend-app")
FRONTEND_DIR=""
LOG_DIR="/tmp/blackswan_logs"
INTERFACE="wlan0"   # interfaz física que quieres poner en monitor
MON_IF=""

mkdir -p "$LOG_DIR"

# ASCII ART - Black Swan
cat << "EOF"

██████╗ ██╗      █████╗  ██████╗██╗  ██╗    ███████╗██╗    ██╗ █████╗ ███╗   ██╗
██╔══██╗██║     ██╔══██╗██╔════╝██║ ██╔╝    ██╔════╝██║    ██║██╔══██╗████╗  ██║
██████╔╝██║     ███████║██║     █████╔╝     ███████╗██║ █╗ ██║███████║██╔██╗ ██║
██╔══██╗██║     ██╔══██║██║     ██╔═██╗     ╚════██║██║███╗██║██╔══██║██║╚██╗██║
██████╔╝███████╗██║  ██║╚██████╗██║  ██╗    ███████║╚███╔███╔╝██║  ██║██║ ╚████║
╚═════╝ ╚══════╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝    ╚══════╝ ╚══╝╚══╝ ╚═╝  ╚═╝╚═╝  ╚═══╝

                            🦢 WiFi Reconnaissance System
                          ===============================

EOF

echo "🚀 Black Swan - start.sh (monitor + frontend + backend)"
echo "========================================================"

# Verificar root
if [ "$EUID" -ne 0 ]; then
  echo "❌ Este script requiere root. Ejecuta: sudo ./start.sh"
  exit 1
fi

# Comprobaciones básicas
command -v airmon-ng >/dev/null || { echo "❌ airmon-ng no encontrado. Instala aircrack-ng."; exit 1; }
command -v iw >/dev/null || { echo "❌ iw no encontrado. Instala iw."; exit 1; }
command -v python3 >/dev/null || { echo "❌ python3 no encontrado."; exit 1; }

# Encontrar carpeta frontend si existe entre variantes
for d in "${POSSIBLE_FRONT_DIRS[@]}"; do
  if [ -d "$d" ]; then
    FRONTEND_DIR="$d"
    break
  fi
done

# Función de limpieza
cleanup() {
  echo ""
  echo "🧹 Cleanup iniciado..."

  if [ -n "${FRONT_PID:-}" ] && kill -0 "$FRONT_PID" 2>/dev/null; then
    echo "   ➜ Matando Frontend (PID $FRONT_PID)"
    kill "$FRONT_PID" 2>/dev/null || true
    sleep 1
    kill -9 "$FRONT_PID" 2>/dev/null || true
  fi

  if [ -n "${BACK_PID:-}" ] && kill -0 "$BACK_PID" 2>/dev/null; then
    echo "   ➜ Matando Backend (PID $BACK_PID)"
    kill "$BACK_PID" 2>/dev/null || true
    sleep 1
    kill -9 "$BACK_PID" 2>/dev/null || true
  fi

  if [ -n "${MON_IF:-}" ]; then
    echo "   ➜ Deteniendo interfaz monitor: $MON_IF"
    airmon-ng stop "$MON_IF" 2>/dev/null || { ip link set "$MON_IF" down 2>/dev/null || true; }
  fi

  echo "   ➜ Intentando restaurar servicios (NetworkManager)..."
  systemctl restart NetworkManager 2>/dev/null || true

  echo "✅ Limpieza completa. Bye."
  exit 0
}

trap cleanup INT TERM

# -----------------------------
# 1) Preparar y levantar monitor
# -----------------------------
echo ""
echo "🔧 Ejecutando: airmon-ng check kill  (puede matar NetworkManager y otros procesos)"
airmon-ng check kill

echo "📡 Iniciando modo monitor en $INTERFACE..."
before_ifaces=$(iw dev | awk '/Interface/ {print $2}' || true)

airmon_output=$(airmon-ng start "$INTERFACE" 2>&1) || {
  echo "❌ falló airmon-ng start (salida):"
  echo "$airmon_output"
  echo "Ejecuta manualmente para debug."
  cleanup
}
echo "$airmon_output"

# Si output dice 'monitor mode already enabled' asumimos INTERFACE como monitor
if echo "$airmon_output" | grep -qi "monitor mode already enabled"; then
  MON_IF="$INTERFACE"
fi

after_ifaces=$(iw dev | awk '/Interface/ {print $2}' || true)

if [ -z "${MON_IF:-}" ]; then
  MON_IF=$(comm -13 <(echo "$before_ifaces" | sort) <(echo "$after_ifaces" | sort) | head -n1 || true)
fi

if [ -z "${MON_IF:-}" ]; then
  if ip link show "${INTERFACE}mon" >/dev/null 2>&1; then
    MON_IF="${INTERFACE}mon"
  elif ip link show "wlan0mon" >/dev/null 2>&1; then
    MON_IF="wlan0mon"
  fi
fi

# último intento de extraer de salida
if [ -z "${MON_IF:-}" ]; then
  maybe=$(echo "$airmon_output" | sed -nE 's/.*enabled for \[phy[0-9]+\]([a-zA-Z0-9:_-]+).*/\1/p' | head -n1 || true)
  if [ -n "$maybe" ]; then
    MON_IF="$maybe"
  fi
fi

echo "✅ Interfaz monitor detectada: ${MON_IF:-(no detectada)}"

# -----------------------------
# 2) Levantar Frontend (si existe)
# -----------------------------
if [ -z "${FRONTEND_DIR:-}" ]; then
  echo ""
  echo "⚠️  No encontré la carpeta del frontend. Busqué: ${POSSIBLE_FRONT_DIRS[*]}"
  echo "   Si tu frontend está en otra carpeta, crea un enlace o renómbrala."
else
  echo ""
  echo "🌐 Iniciando Frontend desde ./$FRONTEND_DIR (logs en vivo)..."
  FRONT_LOG="$LOG_DIR/frontend_$(date +%Y%m%d_%H%M%S).log"

  (
    cd "$FRONTEND_DIR"
    # instalar si falta
    if [ ! -d "node_modules" ]; then
      echo "   ➜ Instalando dependencias frontend (npm ci)..."
      npm ci --silent || npm install --silent || true
    fi
    echo "   ➜ Ejecutando: npm run dev"
    # IMPORTANT: usar ruta absoluta para tee (evita ..//tmp/...)
    npm run dev 2>&1 | tee "$FRONT_LOG"
  ) &
  FRONT_PID=$!
  echo "✅ Frontend arrancado (PID $FRONT_PID). Log: $FRONT_LOG"

  sleep 1
fi

# -----------------------------
# 3) Levantar Backend
# -----------------------------
echo ""
echo "🐍 Iniciando Backend desde ./$BACKEND_DIR (logs en vivo)..."
if [ ! -d "$BACKEND_DIR" ]; then
  echo "❌ Carpeta backend no encontrada: $BACKEND_DIR"
  cleanup
fi

BACK_LOG="$LOG_DIR/backend_$(date +%Y%m%d_%H%M%S).log"
(
  cd "$BACKEND_DIR"
  # activar venv que está dentro de backend/recon/venv (si existe)
  if [ -f "./venv/bin/activate" ]; then
    # shellcheck disable=SC1091
    source ./venv/bin/activate
  elif [ -f "../venv/bin/activate" ]; then
    source ../venv/bin/activate
  fi

  echo "   ➜ Ejecutando: python3 main.py"
  python3 main.py 2>&1 | tee "$BACK_LOG"
) &
BACK_PID=$!
echo "✅ Backend arrancado (PID $BACK_PID). Log: $BACK_LOG"

# -----------------------------
# 4) Estado e loop de espera
# -----------------------------
echo ""
echo "🎯 Estado actual:"
if [ -n "${FRONT_PID:-}" ]; then
  echo "   - Frontend PID: $FRONT_PID (log: $FRONT_LOG)"
else
  echo "   - Frontend: No arrancado."
fi
echo "   - Backend  PID: $BACK_PID (log: $BACK_LOG)"
echo "   - Interface monitor: ${MON_IF:-(no detectada)}"
echo ""
echo "🛑 Presiona Ctrl+C para detener todo y restaurar el estado."

while true; do
  if [ -n "${FRONT_PID:-}" ] && ! kill -0 "$FRONT_PID" 2>/dev/null; then
    echo ""
    echo "❗ Frontend (PID $FRONT_PID) terminó inesperadamente. Revisa $FRONT_LOG"
    cleanup
  fi
  if ! kill -0 "$BACK_PID" 2>/dev/null; then
    echo ""
    echo "❗ Backend (PID $BACK_PID) terminó inesperadamente. Revisa $BACK_LOG"
    cleanup
  fi
  sleep 1
done
