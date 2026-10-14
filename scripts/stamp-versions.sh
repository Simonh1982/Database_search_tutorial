#!/usr/bin/env bash
# Adds a version to the web app's file addresses (app.js?v=1a2b3c4d) when it is published, so
# browsers fetch the new files after every update instead of mixing new and cached old ones.
# Used by .github/workflows/pages.yml. Usage: bash scripts/stamp-versions.sh <folder> <version>
set -euo pipefail
dir="$1"
version="$2"

sed -i -E "s#(src|href)=\"(app\.js|styles\.css)\"#\1=\"\2?v=${version}\"#g" "$dir/index.html"
# Every relative import in every module. A module imported from two places must have the same
# address in both, which it does because every import gets the same version.
sed -i -E "s#from \"(\./[^\"?]+\.js)\"#from \"\1?v=${version}\"#g" "$dir"/*.js "$dir"/shared/*.js

# Fail the deployment if anything was missed.
if grep -nE 'from "\./[^"?]+\.js"' "$dir"/*.js "$dir"/shared/*.js || ! grep -q "app.js?v=${version}" "$dir/index.html"; then
  echo "Some files weren't stamped with a version (see above)." >&2
  exit 1
fi
echo "Stamped web files with version ${version}."
