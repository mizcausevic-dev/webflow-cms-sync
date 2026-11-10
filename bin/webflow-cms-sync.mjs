#!/usr/bin/env node
// Usage: WEBFLOW_TOKEN=... webflow-cms-sync --collection <id> --file posts.csv [--apply] [--publish] [--json]
import { readFileSync } from 'node:fs';
import { WebflowClient } from '../src/client.js';
import { parseCsv } from '../src/csv.js';
import { sync } from '../src/sync.js';

const USAGE = 'usage: webflow-cms-sync --collection <collectionId> --file <data.csv|data.json> [--apply] [--publish] [--json]\n(dry run by default; set WEBFLOW_TOKEN in the environment)';
const args = process.argv.slice(2);
const opt = { apply: false, publish: false, json: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--collection') opt.collection = args[++i];
  else if (a === '--file') opt.file = args[++i];
  else if (a === '--apply') opt.apply = true;
  else if (a === '--publish') opt.publish = true;
  else if (a === '--json') opt.json = true;
  else if (a === '-h' || a === '--help') { console.log(USAGE); process.exit(0); }
  else { console.error(`unknown argument ${a}\n${USAGE}`); process.exit(2); }
}
if (!opt.collection || !opt.file) { console.error(USAGE); process.exit(2); }
if (opt.publish && !opt.apply) { console.error('--publish requires --apply'); process.exit(2); }

try {
  const text = readFileSync(opt.file, 'utf8');
  const records = opt.file.endsWith('.json') ? JSON.parse(text) : parseCsv(text);
  if (!Array.isArray(records)) throw new Error('JSON input must be an array of objects keyed by field slug');
  const client = new WebflowClient({
    token: process.env.WEBFLOW_TOKEN,
    onEvent: (e) => console.error(e.type === 'retry' ? `… ${e.status}, retrying in ${e.waitMs} ms` : `… rate limit nearly exhausted, pacing`),
  });
  const r = await sync(client, { collectionId: opt.collection, records, dryRun: !opt.apply, publish: opt.publish });
  if (opt.json) console.log(JSON.stringify(r, null, 2));
  else {
    const s = r.plan.summary;
    console.log(`${r.dryRun ? 'DRY RUN' : 'APPLIED'}: ${s.create} create, ${s.update} update, ${s.unchanged} unchanged, ${s.invalid} invalid, ${s.duplicates} duplicate, ${s.orphans} only in Webflow`);
    for (const inv of r.plan.invalid) console.log(`  row ${inv.row}: ${inv.errors.join('; ')}`);
    for (const u of r.plan.update) console.log(`  update ${u.fieldData.slug}: ${u.changed.join(', ')}`);
    if (!r.dryRun) console.log(`created ${r.created.length}, updated ${r.updated.length}, published ${r.published.length}, API requests ${client.requests}`);
  }
  process.exit(r.plan.summary.invalid ? 1 : 0);
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
