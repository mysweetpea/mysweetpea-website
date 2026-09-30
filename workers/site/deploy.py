#!/usr/bin/env python3
"""deploy.py — content-hash versioning + validation for workers/site.

KILLS the ?v= ritual: every asset referenced as PATH?v=N in the HTML is
rewritten to PATH?v=h<sha256-8> (hash of the file's CURRENT bytes).
- Identical content => identical URL => caches stay valid across deploys.
- Different content => different URL everywhere SIMULTANEOUSLY. The
  "fonts.css v107 on 13 pages but v108 on one" class of bug is now
  structurally impossible.

Also:
- BAKES assets/site-data.json into assets/js/site-data.js (fallback copy
  embedded between __MSP_BAKED_START__/__MSP_BAKED_END__ markers) and
  stamps BAKED_HASH, so a failed/corrupted fetch can never blank the site.
- Regenerates sw.js: CACHE = mysweetpea-<hash-of-hashes>, and the CORE
  precache list carries the SAME ?v= URLs the HTML requests (one cache
  entry per asset instead of the old unversioned+versioned double-cache;
  offline-first hits the precache entry directly).
- Validates: node --check every JS, control-byte scan, JSON parse, and
  reports whether rebuild_csp.py would change _headers (run it yourself
  after any inline-JS edit; this tool only reminds).

Usage (from workers/site/ or repo root):
  python deploy.py           # rewrite versions + bake + validate + report
  python deploy.py --check   # read-only drift report

Deploy remains: git add/commit/push + `npx wrangler deploy` (manual by law).
"""
import hashlib
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = HERE if os.path.basename(HERE) == 'site' else os.path.join(HERE, 'workers', 'site')

PIN_RE = re.compile(rb'([A-Za-z0-9_\-./]+\.(?:css|js|json))\?v=[A-Za-z0-9]+')
OLD_PIN_RE = re.compile(rb'\?v=\d+')
SW_CACHE_RE = re.compile(rb"const CACHE = '[^']+';")
SW_CORE_JS_RE = re.compile(rb"'(/assets/(?:js|css)/[A-Za-z0-9_\-./]+\.(?:js|css))(?:\?v=[A-Za-z0-9]+)?',")
BAKE_START = b'/* __MSP_BAKED_START__ */'
BAKE_END = b'/* __MSP_BAKED_END__ */'
BAKE_HASH_RE = re.compile(rb"var BAKED_HASH = '[^']*';")
DATA_JS = os.path.join(SITE, 'assets', 'js', 'site-data.js')
DATA_JSON = os.path.join(SITE, 'assets', 'site-data.json')
SW = os.path.join(SITE, 'sw.js')

VERSIONED_HTML_GLOB = '*.html'


def sha8(data: bytes) -> str:
    return 'h' + hashlib.sha256(data).hexdigest()[:8]


def rel(p):
    return os.path.relpath(p, SITE).replace('\\', '/')


def check_mode_only():
    return '--check' in sys.argv


def load(p):
    with open(p, 'rb') as f:
        return f.read()


def save(p, data):
    with open(p, 'wb') as f:
        f.write(data)


def run_node_check(paths):
    """node --check each JS; returns list of failures."""
    fails = []
    for p in paths:
        r = subprocess.run(['node', '--check', p], capture_output=True, text=True)
        if r.returncode != 0:
            fails.append((rel(p), (r.stderr or r.stdout).strip()[:300]))
    return fails


def control_byte_scan(paths):
    """Files must contain no raw control bytes except \\t \\n \\r."""
    bad = []
    for p in paths:
        data = load(p)
        for i, b in enumerate(data):
            if b < 32 and b not in (9, 10, 13):
                bad.append((rel(p), i, hex(b)))
                break
    return bad


def main():
    os.chdir(SITE)
    problems = []
    report = []

    # ---- 0. site-data.json must parse ----
    try:
        raw_json = load(DATA_JSON)
        json.loads(raw_json.decode('utf-8'))
    except Exception as e:
        print('FATAL: assets/site-data.json invalid: %s' % e)
        return 2

    # ---- 1. bake fallback into site-data.js ----
    if not check_mode_only():
        baked_literal = b'var BAKED = ' + json.dumps(
            json.loads(raw_json.decode('utf-8')), separators=(',', ':'), ensure_ascii=True
        ).encode('ascii') + b';'
        sd = load(DATA_JS)
        if BAKE_START not in sd or BAKE_END not in sd:
            print('FATAL: site-data.js bake markers missing')
            return 2
        pre, rest = sd.split(BAKE_START, 1)
        _, post = rest.split(BAKE_END, 1)
        sd = pre + BAKE_START + b'\n    ' + baked_literal + b'\n    ' + BAKE_END + post
        sd = BAKE_HASH_RE.sub(("var BAKED_HASH = '%s';" % sha8(raw_json)).encode(), sd, count=1)
        save(DATA_JS, sd)
        report.append('baked site-data.json (%d bytes) into site-data.js' % len(baked_literal))

    # ---- 2. hash every pinned asset, rewrite HTML pins ----
    pages = sorted(f for f in os.listdir(SITE) if f.endswith('.html'))
    # also: site-data.js must be pinned on pages that use it — verify below
    asset_hash = {}

    def hash_for(url_path_bytes):
        path = url_path_bytes.decode('ascii')
        disk = os.path.join(SITE, path.lstrip('/'))
        if not os.path.isfile(disk):
            problems.append('missing asset on disk: %s' % path)
            return None
        if path not in asset_hash:
            asset_hash[path] = sha8(load(disk))
        return asset_hash[path]

    changed_any = False
    for page in pages:
        p = os.path.join(SITE, page)
        data = load(p)

        def repl(m):
            h = hash_for(m.group(1))
            if h is None:
                return m.group(0)
            return m.group(1) + b'?v=' + h.encode()

        new = PIN_RE.sub(repl, data)
        if new != data:
            changed_any = True
            if not check_mode_only():
                save(p, new)
        leftover = OLD_PIN_RE.search(new)
        if leftover:
            problems.append('%s still has an old-style ?v=N pin near byte %d' % (page, leftover.start()))

    # ---- 3. sw.js: CACHE + versioned CORE ----
    sw = load(SW)
    all_hashes = ''.join(sorted(asset_hash.values()))
    new_cache = ("const CACHE = 'mysweetpea-%s';" % sha8(all_hashes.encode())).encode()

    def core_repl(m):
        path = m.group(1).decode('ascii')
        h = asset_hash.get(path)
        return b"'" + m.group(1) + (b'?v=' + h.encode() if h else b'') + b"',"

    new_sw = SW_CACHE_RE.sub(new_cache, sw, count=1)
    new_sw = SW_CORE_JS_RE.sub(core_repl, new_sw)
    if new_sw != sw:
        changed_any = True
        if not check_mode_only():
            save(SW, new_sw)
    report.append('sw.js CACHE -> %s' % sha8(all_hashes.encode()))

    # ---- 4. validations ----
    js_files = [os.path.join(SITE, 'assets', 'js', f) for f in os.listdir(os.path.join(SITE, 'assets', 'js')) if f.endswith('.js')]
    js_files.append(SW)
    fails = run_node_check(js_files)
    for f, err in fails:
        problems.append('node --check FAILED %s: %s' % (f, err))

    scan_targets = js_files + [os.path.join(SITE, p) for p in pages] + \
        [os.path.join(SITE, 'assets', 'css', f) for f in os.listdir(os.path.join(SITE, 'assets', 'css')) if f.endswith('.css')] + \
        [DATA_JSON]
    cbad = control_byte_scan(scan_targets)
    for f, off, b in cbad:
        problems.append('control byte %s at offset %d in %s' % (b, off, f))

    # site-data.js pinned wherever loaded
    for page in pages:
        data = load(os.path.join(SITE, page))
        if b'site-data.js' in data and b'site-data.js?v=' not in data:
            problems.append('%s loads site-data.js WITHOUT ?v=' % page)

    # CSP drift reminder
    r = subprocess.run([sys.executable, 'rebuild_csp.py', '--check'], capture_output=True, text=True)
    csp_drift = 'OK' if (r.returncode == 0 and 'drift' not in (r.stdout or '').lower()) else 'DRIFT'
    report.append('rebuild_csp.py --check: %s%s' % (csp_drift, '' if csp_drift == 'OK' else ' (run: python rebuild_csp.py)'))

    # ---- 5. report ----
    print('=' * 62)
    print('MySweetPea deploy.py — %s' % ('DRIFT CHECK (no writes)' if check_mode_only() else 'APPLIED'))
    print('=' * 62)
    for line in report:
        print(' ', line)
    print('  %d HTML pages, %d hashed assets, %d JS files checked' % (len(pages), len(asset_hash), len(js_files)))
    if changed_any and check_mode_only():
        print('  DRIFT: versioned files differ from disk hashes')
    if problems:
        print('\nPROBLEMS (%d):' % len(problems))
        for p in problems:
            print('  !! %s' % p)
        return 1
    print('\nAll gates green. Deploy = git commit/push + npx wrangler deploy (manual).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
