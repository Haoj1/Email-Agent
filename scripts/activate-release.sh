#!/usr/bin/env bash
# Run on the deployment host after staging a release and installing its dependencies.
set -euo pipefail

: "${APP_ROOT:?Set APP_ROOT to the release root}"
: "${SERVICE_NAME:?Set SERVICE_NAME to the configured systemd service}"
: "${READY_URL:?Set READY_URL to the active /api/ready endpoint}"
: "${CANDIDATE_PORT:?Set CANDIDATE_PORT to an unused localhost port}"
release=$(realpath "${1:?Pass a prepared release directory}")
root=$(realpath "$APP_ROOT")
[[ "$release" == "$root/releases/"* && -x "$release/backend/.venv/bin/python" ]]
[[ ! -e "$root/current" || -L "$root/current" ]]

cd "$release/backend"
exec 9>"$root/.deploy.lock"
.venv/bin/python -c 'import fcntl; fcntl.flock(9, fcntl.LOCK_EX | fcntl.LOCK_NB)'
previous=$(readlink "$root/current" || true)
candidate_pid=
switched=false
temp_link="$root/.current-$$"

cleanup() {
  if [[ -n "$candidate_pid" ]]; then
    kill "$candidate_pid" 2>/dev/null || true
    wait "$candidate_pid" 2>/dev/null || true
  fi
  rm -f -- "$temp_link"
  if [[ "$switched" == true ]]; then
    rollback || printf 'Could not verify the previous release; inspect the service.\n' >&2
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

switch_link() {
  ln -s -- "$1" "$temp_link"
  .venv/bin/python -c 'import os, sys; os.replace(*sys.argv[1:])' "$temp_link" "$root/current"
}

wait_until_ready() {
  local url=$1 pid=${2:-}
  for _ in {1..20}; do
    if [[ -n "$pid" ]] && ! kill -0 "$pid" 2>/dev/null; then return 1; fi
    if curl -fsS --max-time 2 -o /dev/null "$url" 2>/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}

manage_service() {
  if [[ "${DEPLOY_USE_SUDO:-false}" == true ]]; then
    sudo -n /bin/systemctl "$1" "$SERVICE_NAME"
  else
    systemctl "$1" "$SERVICE_NAME"
  fi
}

rollback() {
  if [[ -n "$previous" ]]; then
    switch_link "$previous" || return 1
    manage_service restart || return 1
    wait_until_ready "${ROLLBACK_HEALTH_URL:-$READY_URL}" || return 1
    printf 'Restored %s\n' "$previous" >&2
  else
    manage_service stop || return 1
    rm -f -- "$root/current"
  fi
}

.venv/bin/python migrate.py
.venv/bin/python -c 'import socket, sys; socket.socket().bind(("127.0.0.1", int(sys.argv[1])))' "$CANDIDATE_PORT"
MAILBOX_SYNC_ENABLED=false .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port "$CANDIDATE_PORT" &
candidate_pid=$!
wait_until_ready "http://127.0.0.1:$CANDIDATE_PORT/api/ready" "$candidate_pid"
kill "$candidate_pid"
wait "$candidate_pid" || true
candidate_pid=

switch_link "$release"
switched=true
if manage_service restart && wait_until_ready "$READY_URL"; then
  switched=false
  printf 'Activated %s\n' "$release"
  exit 0
fi
exit 1
