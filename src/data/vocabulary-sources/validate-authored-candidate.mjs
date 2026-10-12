import fs from 'node:fs';
for (const shard of process.argv.slice(2)) {
  const expected = JSON.parse(fs.readFileSync(`work/vocabulary-content/author-inputs/${shard}.json`, 'utf8'));
  const actual = JSON.parse(fs.readFileSync(`outputs/IELTS_Studio/src/data/vocabulary-authored/${shard}.json`, 'utf8'));
  if (actual.length !== expected.length) throw new Error(`${shard}: length ${actual.length}/${expected.length}`);
  for (const [i, row] of actual.entries()) {
    if (row.length !== 5 || row[0] !== expected[i].term || row.some(x => typeof x !== 'string' || !x.trim())) throw new Error(`${shard}:${i}: invalid row`);
    const escaped = row[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const sentence of row.slice(3)) if ((sentence.match(new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, 'gi')) ?? []).length !== 1) throw new Error(`${shard}:${row[0]}: occurrence`);
    if (row[3] === row[4]) throw new Error(`${shard}:${row[0]}: duplicate`);
  }
  console.log(`${shard}: ${actual.length} rows valid`);
}
