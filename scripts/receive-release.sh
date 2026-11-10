#!/usr/bin/env bash
# Install as a root-owned forced SSH command for the Email Agent service user.
set -euo pipefail
umask 022

request=${SSH_ORIGINAL_COMMAND:-}
if [[ ! "$request" =~ ^release\ ([0-9a-f]{40})\ ([0-9]+)\ ([0-9]+)$ ]]; then
  printf 'Expected a release SHA, run number and attempt.\n' >&2
  exit 2
fi
sha=${BASH_REMATCH[1]}
root=/srv/email-agent
release="$root/releases/$sha-${BASH_REMATCH[2]}-${BASH_REMATCH[3]}"
uv=/opt/email-agent/bin/uv
export UV_PYTHON_INSTALL_DIR=/opt/email-agent/python
export UV_CACHE_DIR="$root/cache"

exec 8>"$root/.receive.lock"
flock -n 8
work=$(mktemp -d "$root/.incoming.XXXXXXXX")
trap 'rm -rf -- "$work"' EXIT
head -c 50331649 > "$work/release.tar.gz"
test "$(stat -c %s "$work/release.tar.gz")" -le 50331648
mkdir "$work/content"
python=$("$uv" python find --managed-python 3.12)
"$python" - "$work" <<'PY'
import sys
import tarfile
from pathlib import Path

directory = Path(sys.argv[1])
with tarfile.open(directory / "release.tar.gz", "r:gz") as archive:
    archive.extractall(directory / "content", filter="data")
PY
test "$(cat "$work/content/REVISION")" = "$sha"
test -f "$work/content/frontend/index.html"
test -f "$work/content/backend/migrate.py"
test -f "$work/content/scripts/activate-release.sh"
test ! -e "$release"
mv -T "$work/content" "$release"

set -a
. /etc/email-agent/backend.env
set +a
"$uv" venv --python "$python" "$release/backend/.venv"
requirements="$release/backend/requirements.txt"
if [[ "${MAILBOX_EMBEDDINGS_ENABLED:-false}" == true ]]; then
  requirements="$release/backend/requirements-embeddings.txt"
fi
"$uv" pip install --python "$release/backend/.venv/bin/python" -r "$requirements"
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
export APP_ROOT="$root" SERVICE_NAME=email-agent.service DEPLOY_USER_SERVICE=true
export READY_URL=http://127.0.0.1:5101/api/ready CANDIDATE_PORT=5102
systemctl --user enable email-agent.service
bash "$release/scripts/activate-release.sh" "$release"
