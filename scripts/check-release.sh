#!/usr/bin/env bash
# Run against the disposable integration database. The candidate is a real local
# API process. Systemd and the existing service endpoint are stubbed.
set -euo pipefail

project=$(cd "$(dirname "$0")/.." && pwd)
temp=$(mktemp -d)
trap 'rm -rf -- "$temp"' EXIT
export APP_ROOT="$temp/app" SERVICE_NAME=email-agent-test READY_URL=http://existing.test/api/ready
export WORKFLOW_PYTHON=${WORKFLOW_PYTHON:-$(python -c 'import sys; print(sys.executable)')}
CANDIDATE_PORT=$("$WORKFLOW_PYTHON" -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
export CANDIDATE_PORT
curl_path=$(command -v curl)
export curl_path
mkdir -p "$temp/bin" "$APP_ROOT/releases/previous/backend"
APP_ROOT=$(realpath "$APP_ROOT")
export FAILED_RELEASE="$APP_ROOT/releases/failure"
for name in candidate failure; do
  backend="$APP_ROOT/releases/$name/backend"
  mkdir -p "$backend/.venv/bin"
  cat > "$backend/.venv/bin/python" <<'STUB'
#!/usr/bin/env bash
exec "$WORKFLOW_PYTHON" "$@"
STUB
  chmod +x "$backend/.venv/bin/python"
  ln -s "$project/backend/app" "$project/backend/main.py" "$project/backend/migrate.py" "$backend/"
done
ln -s "$APP_ROOT/releases/previous" "$APP_ROOT/current"
cat > "$temp/bin/systemctl" <<'STUB'
#!/usr/bin/env bash
[[ "$1" == restart && "$2" == "$SERVICE_NAME" ]] || exit 2
[[ "$(readlink "$APP_ROOT/current")" != "$FAILED_RELEASE" ]]
STUB
cat > "$temp/bin/curl" <<'STUB'
#!/usr/bin/env bash
if [[ "${!#}" == "$READY_URL" ]]; then exit 0; fi
exec "$curl_path" "$@"
STUB
chmod +x "$temp/bin/"*
export PATH="$temp/bin:$PATH"

bash "$project/scripts/activate-release.sh" "$APP_ROOT/releases/candidate"
[[ "$(readlink "$APP_ROOT/current")" == "$APP_ROOT/releases/candidate" ]]
if bash "$project/scripts/activate-release.sh" "$FAILED_RELEASE"; then
  printf 'Expected restart failure to trigger rollback\n' >&2
  exit 1
fi
[[ "$(readlink "$APP_ROOT/current")" == "$APP_ROOT/releases/candidate" ]]
printf 'Candidate readiness and rollback verified.\n'
