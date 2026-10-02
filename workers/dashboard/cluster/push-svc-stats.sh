#!/bin/bash
# Push per-service stats snapshots to the dashboard worker's ingest endpoint.
# In-cluster services (NC/VW/AFFiNE/OWUI) are unreachable from Cloudflare, so
# this script runs on k3s-master (cron) and pushes counts outward.
# Auth: x-msp-internal header (value from homepage-secrets). KV TTL 48h.

set -u
KUBECTL="kubectl --kubeconfig=/etc/rancher/k3s/k3s.yaml"
NS_MON=monitoring
SECRET=homepage-secrets
DASH=https://dashboard.mysweetpea.cc
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126"

hdr() { $KUBECTL -n $NS_MON get secret $SECRET -o jsonpath="{.data.$1}" | base64 -d; }
MSP=$(hdr MSP_INTERNAL_HEADER)
[ -z "$MSP" ] && { echo "no MSP_INTERNAL_HEADER, abort"; exit 1; }

push_stats() { # key json
  curl -s -m 15 -X POST "$DASH/api/ingest/svc-stats" \
    -H "x-msp-internal: $MSP" -H "Content-Type: application/json" -H "User-Agent: $UA" \
    -d "{\"key\":\"$1\",\"stats\":$2}"
}

# ---- Nextcloud: occ user:list + filecache/share/activity via db (through NC pod php) ----
NC_POD=$($KUBECTL -n private get pods -o name 2>/dev/null | grep -m1 nextcloud | cut -d/ -f2)
if [ -n "$NC_POD" ]; then
  NC_JSON=$($KUBECTL -n private exec "$NC_POD" -c nextcloud -- php /tmp/svc-stats-nc.php 2>/dev/null)
  if [ -z "$NC_JSON" ]; then
    # install the helper if missing (idempotent)
    $KUBECTL -n private exec -i "$NC_POD" -c nextcloud -- sh -c 'cat > /tmp/svc-stats-nc.php' <<'PHPEOF'
<?php
include "/var/www/html/config/config.php";
$pdo = new PDO("pgsql:host=" . $CONFIG["dbhost"] . ";dbname=" . $CONFIG["dbname"], $CONFIG["dbuser"], $CONFIG["dbpassword"]);
echo json_encode([
 "nc_files" => (int)$pdo->query("SELECT COUNT(*) FROM oc_filecache WHERE path LIKE 'files/%'")->fetchColumn(),
 "nc_shares" => (int)$pdo->query("SELECT COUNT(*) FROM oc_share")->fetchColumn(),
 "nc_activity" => (int)$pdo->query("SELECT COUNT(*) FROM oc_activity WHERE timestamp > " . (time()-2592000))->fetchColumn(),
]);
PHPEOF
    NC_JSON=$($KUBECTL -n private exec "$NC_POD" -c nextcloud -- php /tmp/svc-stats-nc.php 2>/dev/null)
  fi
  [ -n "$NC_JSON" ] && echo "nc: $(push_stats nextcloud "$NC_JSON")"
fi

# ---- Vaultwarden: sqlite users/ciphers via pod cat -> local python (no sqlite3 in pod) ----
VW_POD=$($KUBECTL -n dmz get pods -o name 2>/dev/null | grep -m1 vaultwarden | cut -d/ -f2)
if [ -n "$VW_POD" ] && command -v python3 >/dev/null; then
  TMP=$(mktemp)
  $KUBECTL -n dmz exec "$VW_POD" -- cat /data/db.sqlite3 > "$TMP" 2>/dev/null
  VW_JSON=$(python3 - "$TMP" <<'PYEOF'
import sqlite3, json, sys
try:
    c = sqlite3.connect(sys.argv[1])
    print(json.dumps({
        "vw_users": c.execute("SELECT COUNT(*) FROM users").fetchone()[0],
        "vw_items": c.execute("SELECT COUNT(*) FROM ciphers").fetchone()[0],
    }))
except Exception:
    pass
PYEOF
)
  rm -f "$TMP"
  [ -n "$VW_JSON" ] && echo "vw: $(push_stats vaultwarden "$VW_JSON")"
fi

# ---- AFFiNE: workspaces/users/docs via NC pod PDO -> affine db ----
AF_POD=$($KUBECTL -n dmz get pods -o name 2>/dev/null | grep -m1 affine-main | cut -d/ -f2)
if [ -n "$AF_POD" ] && [ -n "$NC_POD" ]; then
  AP=$($KUBECTL -n dmz exec "$AF_POD" -- node -e 'const u=new URL(process.env.DATABASE_URL); console.log(u.password)' 2>/dev/null)
  if [ -n "$AP" ]; then
    AF_JSON=$($KUBECTL -n private exec -i "$NC_POD" -c nextcloud -- php /tmp/svc-stats-af.php 2>/dev/null)
    if [ -z "$AF_JSON" ]; then
      $KUBECTL -n private exec -i "$NC_POD" -c nextcloud -- sh -c "cat > /tmp/svc-stats-af.php" <<PHPEOF
<?php
\$pdo = new PDO("pgsql:host=postgresql.private.svc.cluster.local;dbname=affine", "affine", "$AP");
echo json_encode([
 "affine_workspaces" => (int)\$pdo->query("SELECT COUNT(*) FROM workspaces")->fetchColumn(),
 "affine_users" => (int)\$pdo->query("SELECT COUNT(*) FROM \"users\"")->fetchColumn(),
 "affine_docs" => (int)\$pdo->query("SELECT COUNT(*) FROM workspace_pages")->fetchColumn(),
]);
PHPEOF
      AF_JSON=$($KUBECTL -n private exec "$NC_POD" -c nextcloud -- php /tmp/svc-stats-af.php 2>/dev/null)
    fi
    [ -n "$AF_JSON" ] && echo "affine: $(push_stats affine "$AF_JSON")"
  fi
fi

# ---- Open WebUI: users/chats via python sqlite in its pod ----
OW_POD=$($KUBECTL -n private get pods -o name 2>/dev/null | grep -m1 open-webui | cut -d/ -f2)
if [ -n "$OW_POD" ]; then
  OW_JSON=$($KUBECTL -n private exec "$OW_POD" -- python3 -c "
import sqlite3, json
c = sqlite3.connect('/app/backend/data/webui.db')
print(json.dumps({
 'owui_users': c.execute('SELECT COUNT(*) FROM user').fetchone()[0],
 'owui_chats': c.execute('SELECT COUNT(*) FROM chat').fetchone()[0],
}))" 2>/dev/null)
  [ -n "$OW_JSON" ] && echo "owui: $(push_stats openwebui "$OW_JSON")"
fi

echo "svc-stats push done $(date -Is)"
