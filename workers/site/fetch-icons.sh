#!/usr/bin/env bash
set -e

ICON_DIR="assets/icons"
mkdir -p "$ICON_DIR"

echo "== simple-icons =="
for slug in vaultwarden matrix affine jellyfin nextcloud immich grafana prometheus syncthing; do
  curl -fsSL "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/${slug}.svg" -o "${ICON_DIR}/${slug}.svg"
  echo "  ✓ ${slug}.svg"
done

echo "== selfh.st/icons =="
curl -fsSL "https://cdn.jsdelivr.net/gh/selfhst/icons/svg/open-webui.svg" -o "${ICON_DIR}/openwebui.svg" && echo "  ✓ openwebui.svg (renamed)"

echo "== koalasync =="
echo "  ⚠ Manual: save logo from https://sync.koalastuff.net as ${ICON_DIR}/koalasync.svg"
echo "  ⚠ Fallback: https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/syncplay.svg → ${ICON_DIR}/koalasync.svg"

echo ""
echo "Done. Verify each file opens in a browser, then:"
echo "  git add assets/icons && git commit -m 'Add service icons' && git push"
