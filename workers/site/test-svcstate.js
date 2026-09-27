// Unit tests for svcState (extracted from premium.js) — recovery-moment semantics
const src = require('fs').readFileSync('assets/js/premium.js', 'utf8');
new Function(src); // parse gate

const m = src.match(/var RECOVERY_HOLD_MS[\s\S]*?return \(now - recAt\) >= RECOVERY_HOLD_MS \? 'live' : 'recovering';\n    \}/);
if (!m) { console.error('svcState not found'); process.exit(1); }
const svcState = new Function('list', 'up24', 'nowMs',
  m[0] + '\nreturn svcState(list, up24, nowMs);');

const now = Date.now();
const iso = ms => new Date(ms).toISOString();

// user's exact scenario: down 10:00-10:05, beats every ~4-5 min
const scenario = (minsSinceRecovery) => {
  const t0 = now - (minsSinceRecovery + 5) * 60000; // 10:00 down
  return [
    { status: 0, time: iso(t0) },
    { status: 0, time: iso(t0 + 4 * 60000) },
    { status: 1, time: iso(t0 + 5 * 60000) },              // back up
    { status: 1, time: iso(t0 + 9 * 60000) },
    { status: 1, time: iso(t0 + 5 * 60000 + minsSinceRecovery * 60000) } // newest
  ];
};

const tests = [
  [scenario(1), 0.93, 'up 1 min after outage -> recovering (10:06)', 'recovering'],
  [scenario(9), 0.93, 'up 9 min after outage -> recovering (10:14)', 'recovering'],
  [scenario(10), 0.93, 'up 10 min after outage -> live (10:15)', 'live'],
  [scenario(30), 0.95, 'up 30 min, avg still <99.5 -> live', 'live'],
  [[{ status: 1, time: iso(now - 2 * 60000) }], 0.93, 'all-up list, oldest beat 2min -> recovering', 'recovering'],
  [[{ status: 1, time: iso(now - 12 * 60000) }], 0.93, 'all-up list, oldest beat 12min -> live', 'live'],
  [[{ status: 0, time: iso(now - 60000) }], 0.5, 'down right now -> down', 'down'],
  [[{ status: 1, time: iso(now - 60000) }], 0.999, 'healthy avg -> live regardless', 'live'],
  [null, undefined, 'no data -> unknown', 'unknown'],
  [[{ status: 1, time: 'garbage' }], 0.9, 'unparseable time -> conservative recovering', 'recovering'],
  [[{ status: 0, time: iso(now - 8 * 60000) }, { status: 1, time: iso(now - 6 * 60000) }], 0.93, 'recovered 6min ago, newest=recovery beat -> recovering', 'recovering']
];

let fail = 0;
for (const [list, up24, name, want] of tests) {
  const got = svcState(list, up24, now);
  console.log((got === want ? 'PASS' : 'FAIL') + '  ' + name + '  -> ' + got);
  if (got !== want) fail = 1;
}
process.exit(fail);
