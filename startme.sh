#!/usr/bin/env bash

set -euo pipefail

PORT=3000

while getopts ":p:" opt; do
  case "$opt" in
    p)
      PORT="$OPTARG"
      ;;
    :)
      echo "Option -$OPTARG requires a value." >&2
      exit 1
      ;;
    \?)
      echo "Usage: $0 [-p port]" >&2
      exit 1
      ;;
  esac
done

if ! [[ "$PORT" =~ ^[0-9]+$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  echo "Port must be an integer between 1 and 65535." >&2
  exit 1
fi

PORT="$PORT" exec node server.js
