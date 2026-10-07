#!/usr/bin/env bash
# Makes the tutor's port public so the GitHub Pages site (and colleagues) can reach it.
# Run inside the Codespace: npm run share
set -euo pipefail
PORT="${PORT:-3000}"

if [ -z "${CODESPACE_NAME:-}" ]; then
  echo "This only works inside a GitHub Codespace."
  exit 1
fi

if gh codespace ports visibility "${PORT}:public" -c "$CODESPACE_NAME"; then
  DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  BACKEND="https://${CODESPACE_NAME}-${PORT}.${DOMAIN}"
  REPO="${GITHUB_REPOSITORY:-Simonh1982/Database_search_tutorial}"
  OWNER="$(echo "${REPO%%/*}" | tr '[:upper:]' '[:lower:]')"
  PAGES="${PAGES_URL:-https://${OWNER}.github.io/${REPO#*/}/}"
  echo
  echo "Port ${PORT} is now public. Share this link with colleagues:"
  echo "  ${PAGES}?backend=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$BACKEND")"
  echo
  echo "To make it private again: gh codespace ports visibility ${PORT}:private -c \"\$CODESPACE_NAME\""
else
  echo
  echo "Couldn't change the port automatically. Instead, open the PORTS tab in VS Code,"
  echo "right-click port ${PORT}, and choose Port Visibility > Public."
fi
