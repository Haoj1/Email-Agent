#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
bundle=${1:?Pass an output tar.gz path}
test -f frontend/build/index.html
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
git archive HEAD backend scripts | tar -xf - -C "$stage"
mkdir "$stage/frontend"
cp -a frontend/build/. "$stage/frontend/"
git rev-parse HEAD > "$stage/REVISION"
tar -czf "$bundle" -C "$stage" .
