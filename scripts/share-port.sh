#!/usr/bin/env bash
# Makes the tutor's port public so the GitHub Pages site (and colleagues) can reach it,
# then prints the link to share. Run inside the Codespace: npm run share
set -uo pipefail
PORT="${PORT:-3000}"

if [ -z "${CODESPACE_NAME:-}" ]; then
  echo "This only works inside a GitHub Codespace."
  exit 1
fi

DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
BACKEND="https://${CODESPACE_NAME}-${PORT}.${DOMAIN}"
REPO="${GITHUB_REPOSITORY:-Simonh1982/Database_search_tutorial}"
OWNER="$(echo "${REPO%%/*}" | tr '[:upper:]' '[:lower:]')"
PAGES="${PAGES_URL:-https://${OWNER}.github.io/${REPO#*/}/}"
LINK="${PAGES}?backend=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$BACKEND")"

echo
if gh codespace ports visibility "${PORT}:public" -c "$CODESPACE_NAME" >/dev/null 2>&1; then
  echo "Port ${PORT} is now public."
else
  echo "Couldn't make port ${PORT} public automatically. Please do it by hand:"
  echo "  open the PORTS tab (next to TERMINAL), right-click port ${PORT},"
  echo "  choose Port Visibility, then Public."
fi
echo
echo "Link to share with colleagues:"
echo
echo "  ${LINK}"
echo
echo "(It works while this Codespace is running. To make the port private again,"
echo " right-click port ${PORT} in the PORTS tab and choose Port Visibility, then Private.)"
