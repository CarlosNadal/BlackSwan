#!/usr/bin/env bash
set -euo pipefail

TARGET=""
IFACE="wlan0mon"
CHANNEL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --iface) IFACE="$2"; shift 2 ;;
    --channel) CHANNEL="$2"; shift 2 ;;
    *) echo "Unknown arg $1"; exit 1 ;;
  esac
done

if [[ -z "$TARGET" ]]; then
  echo "Missing --target" >&2
  exit 2
fi

LOGDIR="$(dirname "$0")"
echo "$(date --iso-8601=seconds) handshake capture target=$TARGET iface=$IFACE channel=$CHANNEL" >> "$LOGDIR/attack.log"

# Launch airodump-ng recording (example - adapt to your layout)
if [[ -n "$CHANNEL" ]]; then
  sudo airodump-ng --bssid "$TARGET" -c "$CHANNEL" -w "$LOGDIR/handshake-${TARGET//:/}" "$IFACE"
else
  sudo airodump-ng --bssid "$TARGET" -w "$LOGDIR/handshake-${TARGET//:/}" "$IFACE"
fi
