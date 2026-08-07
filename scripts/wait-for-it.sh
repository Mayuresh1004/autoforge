#!/usr/bin/env bash
# Wait for a service to become available
set -euo pipefail

HOST="${1:?Usage: wait-for-it.sh <host:port> [-- command]}"
TIMEOUT="${WAIT_TIMEOUT:-60}"

host="${HOST%%:*}"
port="${HOST##*:}"

echo "Waiting for ${host}:${port} (timeout: ${TIMEOUT}s)..."

for i in $(seq 1 "$TIMEOUT"); do
  if bash -c "echo > /dev/tcp/${host}/${port}" 2>/dev/null; then
    echo "${host}:${port} is available"
    shift
    if [ "${1:-}" = "--" ]; then
      shift
      exec "$@"
    fi
    exit 0
  fi
  sleep 1
done

echo "Timeout waiting for ${host}:${port}"
exit 1
