#!/usr/bin/env bash
# Fails if anything key-shaped is tracked by git (run by `npm run check`; also handy as a pre-commit hook:
#   ln -s ../../scripts/check-secrets.sh .git/hooks/pre-commit)
set -euo pipefail
PATTERNS='AIza[0-9A-Za-z_-]{30,}|AQ\.[A-Za-z0-9_-]{30,}|sk_[0-9a-f]{40,}|sk-ant-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|"private_key_id"|xi-api-key: *[A-Za-z0-9_]{20,}'
hits=$(git grep -nIE "$PATTERNS" -- ':!scripts/check-secrets.sh' ':!package-lock.json' $( [ "${1:-}" = "--staged" ] && echo --cached ) || true)
if [ -n "$hits" ]; then
  echo "✖ possible secrets in tracked files:"; echo "$hits" | sed -E 's/(AIza|AQ\.|sk_|sk-ant-)[A-Za-z0-9_.-]{6}[A-Za-z0-9_.-]*/\1******/g'
  exit 1
fi
echo "✔ no secrets in tracked files"
