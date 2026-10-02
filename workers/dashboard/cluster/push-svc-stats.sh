#!/bin/bash
# Push per-service stats to the dashboard worker ingest.
# Runs ON THE VPS: cluster reads go via SSH to k3s-master (NetBird), POSTs go
# out from the VPS (clean IP - home IPs get CF-challenged on this host).
set -u
MASTER=${MASTER:-root@100.82.169.28}
kctl() { ssh -o StrictHostKeyChecking=no -o ConnectTimeout=8 "$MASTER" kubectl --kubeconfig=/etc/rancher/k3s/k3s.yaml "$@"; }
DASH=https://dashboard.mysweetpea.cc
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126"

MSP=$(kctl -n monitoring get secret homepage-secrets -o jsonpath='{.data.MSP_INTERNAL_HEADER}' | base64 -d)
[ -z "$MSP" ] && { echo "no MSP_INTERNAL_HEADER, abort"; exit 1; }

push_stats() { # key json
  curl -s -m 15 -X POST "$DASH/api/ingest/svc-stats" \
    -H "x-msp-internal: $MSP" -H "Content-Type: application/json" -H "User-Agent: $UA" \
    -d "{\"key\":\"$1\",\"stats\":$2}"
}

# ---- Nextcloud ----
NC_POD=$(kctl -n private get pods -o name 2>/dev/null | grep -m1 nextcloud | cut -d/ -f2)
if [ -n "$NC_POD" ]; then
  NC_JSON=$(kctl -n private exec "$NC_POD" -c nextcloud -- php /tmp/svc-stats-nc.php 2>/dev/null)
  if [ -z "$NC_JSON" ]; then
    kctl -n private exec -i "$NC_POD" -c nextcloud -- sh -c 'cat > /tmp/svc-stats-nc.php' <<'PHPEOF'
<?php
include "/var/www/html/config/config.php";
$pdo = new PDO("pgsql:host=" . $CONFIG["dbhost"] . ";dbname=" . $CONFIG["dbname"], $CONFIG["dbuser"], $CONFIG["dbpassword"]);
echo json_encode([
 "nc_files" => (int)$pdo->query("SELECT COUNT(*) FROM oc_filecache WHERE path LIKE 'files/%'")->fetchColumn(),
 "nc_shares" => (int)$pdo->query("SELECT COUNT(*) FROM oc_share")->fetchColumn(),
 "nc_activity" => (int)$pdo->query("SELECT COUNT(*) FROM oc_activity WHERE timestamp > " . (time()-2592000))->fetchColumn(),
]);
PHPEOF
    NC_JSON=$(kctl -n private exec "$NC_POD" -c nextcloud -- php /tmp/svc-stats-nc.php 2>/dev/null)
  fi
  [ -n "$NC_JSON" ] && echo "nc: $(push_stats nextcloud "$NC_JSON")"
fi

# ---- Vaultwarden ----
VW_POD=$(kctl -n dmz get pods -o name 2>/dev/null | grep -m1 vaultwarden | cut -d/ -f2)
if [ -n "$VW_POD" ] && command -v python3 >/dev/null; then
  TMP=$(mktemp)
  kctl -n dmz exec "$VW_POD" -- cat /data/db.sqlite3 > "$TMP" 2>/dev/null
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

# ---- AFFiNE ----
AF_POD=$(kctl -n dmz get pods -o name 2>/dev/null | grep -m1 affine-main | cut -d/ -f2)
if [ -n "$AF_POD" ] && [ -n "$NC_POD" ]; then
  # base64 survives ssh word-splitting; decode locally
  AP=$(echo "$(kctl -n dmz exec "$AF_POD" -c main -- printenv DATABASE_URL 2>/dev/null | base64 -w0)" | base64 -d | sed -n 's|postgresql://[^:]*:\([^@]*\)@.*|\1|p')
  if [ -n "$AP" ]; then
    AF_JSON=$(kctl -n private exec -i "$NC_POD" -c nextcloud -- php /tmp/svc-stats-af.php 2>/dev/null)
    if [ -z "$AF_JSON" ]; then
      kctl -n private exec -i "$NC_POD" -c nextcloud -- sh -c "cat > /tmp/svc-stats-af.php" <<PHPEOF
<?php
\$pdo = new PDO("pgsql:host=postgresql.private.svc.cluster.local;dbname=affine", "affine", "$AP");
echo json_encode([
 "affine_workspaces" => (int)\$pdo->query("SELECT COUNT(*) FROM workspaces")->fetchColumn(),
 "affine_users" => (int)\$pdo->query("SELECT COUNT(*) FROM \"users\"")->fetchColumn(),
 "affine_docs" => (int)\$pdo->query("SELECT COUNT(*) FROM workspace_pages")->fetchColumn(),
]);
PHPEOF
      AF_JSON=$(kctl -n private exec "$NC_POD" -c nextcloud -- php /tmp/svc-stats-af.php 2>/dev/null)
    fi
    [ -n "$AF_JSON" ] && echo "affine: $(push_stats affine "$AF_JSON")"
  fi
fi

# ---- Open WebUI ----
OW_POD=$(kctl -n private get pods -o name 2>/dev/null | grep -m1 open-webui | cut -d/ -f2)
if [ -n "$OW_POD" ]; then
  # base64-carried script (stdin heredocs don't survive the ssh+ssh hop)
  OW_B64="aW1wb3J0IHNxbGl0ZTMsIGpzb24KYyA9IHNxbGl0ZTMuY29ubmVjdCgnL2FwcC9iYWNrZW5kL2RhdGEvd2VidWkuZGInKQpwcmludChqc29uLmR1bXBzKHsKICdvd3VpX3VzZXJzJzogYy5leGVjdXRlKCdTRUxFQ1QgQ09VTlQoKikgRlJPTSB1c2VyJykuZmV0Y2hvbmUoKVswXSwKICdvd3VpX2NoYXRzJzogYy5leGVjdXRlKCdTRUxFQ1QgQ09VTlQoKikgRlJPTSBjaGF0JykuZmV0Y2hvbmUoKVswXSwKfSkp"
  OW_JSON=$(ssh -o StrictHostKeyChecking=no -o ConnectTimeout=8 "$MASTER" "kubectl --kubeconfig=/etc/rancher/k3s/k3s.yaml -n private exec $OW_POD -- python3 -c 'import base64;exec(base64.b64decode(\"$OW_B64\").decode())'" 2>/dev/null)

  [ -n "$OW_JSON" ] && echo "owui: $(push_stats openwebui "$OW_JSON")"
fi

echo "svc-stats push done $(date -Is)"
