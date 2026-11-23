"""Geometry check for the section-03 </> glyph: converts the real path `d`
(absolute and relative commands) to absolute polylines, then asserts the three
strokes share a vertical centre, the slash is ~1.6x the chevrons, and the ink
box is centred in the 24 viewBox. Run: python3 seal-glyph-check.py"""
import re, sys

DEFAULTS = "M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5"
VIEW = 24.0
STROKE = 1.4

def parse(d):
    """-> list of strokes; each stroke = list of (x, y). Handles M m L l H h V v Z z."""
    toks = re.findall(r'[MmLlHhVvZz]|-?\d*\.?\d+', d)
    strokes, cur, x, y, cmd, i = [], [], 0.0, 0.0, None, 0
    while i < len(toks):
        t = toks[i]
        if re.fullmatch(r'[MmLlHhVvZz]', t):
            cmd = t; i += 1
            if cmd in 'Zz':
                if cur: strokes.append(cur); cur = []
                continue
            continue
        if cmd in 'Mm':
            nx, ny = float(toks[i]), float(toks[i + 1]); i += 2
            if cmd == 'm': nx, ny = x + nx, y + ny
            if cur: strokes.append(cur)
            cur = [(nx, ny)]; x, y = nx, ny
            cmd = 'L' if cmd == 'M' else 'l'          # implicit lineto after moveto
        elif cmd in 'Ll':
            nx, ny = float(toks[i]), float(toks[i + 1]); i += 2
            if cmd == 'l': nx, ny = x + nx, y + ny
            cur.append((nx, ny)); x, y = nx, ny
        elif cmd in 'Hh':
            nx = float(toks[i]); i += 1
            if cmd == 'h': nx = x + nx
            cur.append((nx, y)); x = nx
        elif cmd in 'Vv':
            ny = float(toks[i]); i += 1
            if cmd == 'v': ny = y + ny
            cur.append((x, ny)); y = ny
        else:
            raise SystemExit('unsupported command in d: %r' % cmd)
    if cur: strokes.append(cur)
    return strokes

def extent(pts):
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)

def check(d=DEFAULTS):
    st = parse(d)
    assert len(st) == 3, f'expected 3 strokes, got {len(st)}'
    ex = [extent(s) for s in st]
    cy = [y + h / 2 for _, y, _, h in ex]
    assert max(cy) - min(cy) < 0.01, f'strokes not vertically centred: {cy}'
    hs = sorted(h for _, _, _, h in ex)
    chev, slash = hs[0], hs[-1]
    assert 1.5 < slash / chev < 1.7, f'slash/chevron ratio {slash/chev:.2f} (want ~1.57)'
    lx = min(x for x, _, _, _ in ex); rx = max(x + w for x, _, w, _ in ex)
    ty = min(y for _, y, _, _ in ex); by = max(y + h for _, y, _, h in ex)
    assert abs(lx - (VIEW - rx)) < 0.01, f'ink box not h-centred: {lx} vs {VIEW-rx}'
    assert abs(ty - (VIEW - by)) < 0.01, f'ink box not v-centred: {ty} vs {VIEW-by}'
    assert lx - STROKE / 2 > 0 and VIEW - rx - STROKE / 2 > 0, 'stroke clips the viewBox'
    # slash must not touch a chevron: min endpoint-to-segment distance > stroke
    import math
    slash_pts = next(s for s in st if extent(s)[3] == slash)
    chev_pts = [s for s in st if extent(s)[3] == chev]
    def seg_dist(p, a, b):
        dx, dy = b[0] - a[0], b[1] - a[1]
        t = max(0, min(1, ((p[0]-a[0])*dx + (p[1]-a[1])*dy) / (dx*dx + dy*dy or 1)))
        return math.hypot(p[0]-(a[0]+dx*t), p[1]-(a[1]+dy*t))
    gaps = [seg_dist(e, slash_pts[0], slash_pts[-1]) for c in chev_pts for e in (c[0], c[-1])]
    assert min(gaps) > STROKE, f'round caps merge: min gap {min(gaps):.2f} vs stroke {STROKE}'
    return dict(cy=cy, ratio=round(slash/chev, 3), margins=(round(lx,2), round(VIEW-rx,2)),
                gaps=round(min(gaps), 2))

if __name__ == '__main__':
    d = sys.argv[1] if len(sys.argv) > 1 else DEFAULTS
    print('glyph OK:', check(d))
