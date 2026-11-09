// Boundary sanitising for untrusted API list payloads.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const src = fs.readFileSync(require('node:path').join(__dirname, 'public/index.html'), 'utf8');
const m = src.match(/const validObjects = ([^\n]+);/);
assert.ok(m, 'shared validObjects sanitizer is missing');
const validObjects = new Function(`return (${m[1]})`)();
assert.deepEqual(validObjects([null, { id: 1 }, 0, 'x', undefined, { id: 2 }]), [{ id: 1 }, { id: 2 }]);
assert.deepEqual(validObjects(null), []);
assert.deepEqual(validObjects({}), []);
const urlMatch = src.match(/const safeHttpUrl = ([^\n]+);/);
assert.ok(urlMatch, 'shared safeHttpUrl validator is missing');
const safeHttpUrl = new Function('URL', `return (${urlMatch[1]})`)(URL);
assert.equal(safeHttpUrl('javascript:alert(1)'), '');
assert.equal(safeHttpUrl('data:text/html,x'), '');
assert.equal(safeHttpUrl('https://github.com/mysweetpea/mysweetpea-homelab/commit/abc'), 'https://github.com/mysweetpea/mysweetpea-homelab/commit/abc');
for (const marker of ['validObjects(d.items)', 'validObjects(d.genres)', 'validObjects(updData.updates)', 'safeHttpUrl(u.releaseUrl)']) {
  assert.ok(src.includes(marker), marker);
}
const topList = src.match(/const list = \(Array\.isArray\(items\) \? items : \[\]\)[\s\S]*?\.slice\(0, 9\);/);
assert.ok(topList, 'Top-titles list builder missing');
const topItems = new Function('items', `${topList[0]} return list;`)([{ playCount: 1 }, null, { playCount: 9 }, { playCount: 3 }]);
assert.deepEqual(topItems.map(x => x.playCount), [9, 3, 1], 'Most watched must sort by descending real play count');
console.log('PASS malformed API list entries are dropped at every media/update boundary');
