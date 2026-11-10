import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv } from '../src/csv.js';
import { coerce, toFieldData, slugify } from '../src/schema.js';
import { buildPlan, chunk } from '../src/plan.js';
import { WebflowClient, WebflowApiError } from '../src/client.js';
import { sync } from '../src/sync.js';
import { fakeWebflow } from './fake-webflow.js';

const collection = JSON.parse(readFileSync(new URL('../examples/collection.json', import.meta.url)));
const csv = readFileSync(new URL('../examples/case-studies.csv', import.meta.url), 'utf8');
const noSleep = async () => {};
const client = (fake, extra = {}) => new WebflowClient({ token: 'test-token', fetch: fake.fetch, sleep: noSleep, ...extra });

test('CSV parser handles quotes, escaped quotes, CRLF and embedded newlines', () => {
  const rows = parseCsv('a,b\r\n"x, y","he said ""hi"""\n"multi\nline",2\n');
  assert.deepEqual(rows, [{ a: 'x, y', b: 'he said "hi"' }, { a: 'multi\nline', b: '2' }]);
  assert.throws(() => parseCsv('a\n"open'), SyntaxError);
});

test('slugify produces Webflow-safe slugs', () => {
  assert.equal(slugify('Pricing Page, Rebuilt!'), 'pricing-page-rebuilt');
  assert.equal(slugify('Café Déjà Vu'), 'cafe-deja-vu');
});

test('coercion per field type', () => {
  const f = (type, extra = {}) => ({ slug: 'x', type, ...extra });
  assert.deepEqual(coerce(f('Number'), '1,234.5'), { value: 1234.5 });
  assert.deepEqual(coerce(f('Switch'), 'Yes'), { value: true });
  assert.equal(coerce(f('Switch'), 'maybe').error, '"maybe" is not a boolean');
  assert.equal(coerce(f('DateTime'), '2026-03-02').value, '2026-03-02T00:00:00.000Z');
  assert.ok(coerce(f('Link'), 'javascript:alert(1)').error);
  assert.ok(coerce(f('Email'), 'nope').error);
  assert.deepEqual(coerce(f('Option', { validations: { options: [{ id: 'o1', name: 'SaaS' }] } }), 'saas'), { value: 'o1' });
  assert.ok(coerce(f('PlainText', { validations: { maxLength: 3 } }), 'abcd').error);
});

test('toFieldData derives slug, enforces required fields, rejects unknown columns', () => {
  const r = toFieldData({ name: 'Hello World', client: 'Acme' }, collection.fields);
  assert.equal(r.fieldData.slug, 'hello-world');
  assert.deepEqual(r.errors, []);
  assert.match(toFieldData({ name: 'X' }, collection.fields).errors.join(), /client: required/);
  assert.match(toFieldData({ name: 'X', client: 'Y', colour: 'red' }, collection.fields).errors.join(), /unknown field "colour"/);
});

test('plan: create, update (only changed fields), unchanged, invalid, duplicate, orphan', () => {
  const records = parseCsv(csv);
  const existing = [
    { id: 'a'.repeat(24), fieldData: { name: 'Checkout Redesign', slug: 'checkout-redesign', client: 'Northwind Pay', 'conversion-lift': 15 } },
    { id: 'b'.repeat(24), fieldData: { name: 'Patient Portal Migration', slug: 'patient-portal-migration', client: 'Harbor Health', industry: 'opt-health', 'conversion-lift': 9, featured: false, 'published-on': '2026-04-17T00:00:00.000Z', 'live-url': 'https://example.com/harbor' } },
    { id: 'c'.repeat(24), fieldData: { name: 'Old Story', slug: 'old-story', client: 'Gone' } },
  ];
  const plan = buildPlan({ records: [...records, records[0]], existing, fields: collection.fields });
  assert.deepEqual(plan.summary, { create: 1, update: 1, unchanged: 1, invalid: 2, duplicates: 1, orphans: 1 });
  assert.ok(plan.update[0].changed.includes('conversion-lift'));
  assert.ok(!plan.update[0].changed.includes('name'));
  const invalidErrors = plan.invalid.flatMap((i) => i.errors).join(' | ');
  assert.match(invalidErrors, /industry: "Retail" is not one of/);
  assert.match(invalidErrors, /not a number/);
  assert.match(invalidErrors, /not an http\(s\) URL/);
});

test('chunk splits at the 100-item API limit', () => {
  assert.deepEqual(chunk([...Array(250).keys()], 100).map((c) => c.length), [100, 100, 50]);
});

test('client refuses a missing token and non-Webflow ids', () => {
  assert.throws(() => new WebflowClient({ token: '' }), /token is required/);
  assert.throws(() => WebflowClient.assertId('../../sites'), TypeError);
});

test('end to end against the fake API: dry run writes nothing', async () => {
  const fake = fakeWebflow({ collection });
  const r = await sync(client(fake), { collectionId: collection.id, records: parseCsv(csv), dryRun: true });
  assert.equal(r.plan.summary.create, 3);
  assert.ok(fake.log.every((l) => l.startsWith('GET ')), 'dry run must only read');
});

test('end to end: batches 250 creates into 3 requests, publishes, second run is a no-op', async () => {
  const fake = fakeWebflow({ collection });
  const records = Array.from({ length: 250 }, (_, i) => ({ name: `Story ${i}`, client: `Client ${i}`, 'conversion-lift': String(i) }));
  const r = await sync(client(fake), { collectionId: collection.id, records, dryRun: false, publish: true });
  assert.equal(r.created.length, 250);
  assert.equal(r.published.length, 250);
  assert.equal(fake.log.filter((l) => l.startsWith('POST') && l.includes('/items/insert')).length, 3);
  assert.equal(fake.log.filter((l) => l.includes('/items/publish')).length, 3);
  const again = await sync(client(fake), { collectionId: collection.id, records, dryRun: false });
  assert.equal(again.plan.summary.unchanged, 250);
  assert.equal(again.created.length + again.updated.length, 0);
});

test('429 responses are retried honoring Retry-After', async () => {
  const fake = fakeWebflow({ collection, rateLimitEvery: 3 });
  const waits = [];
  const c = client(fake, { sleep: async (ms) => { waits.push(ms); } });
  const records = Array.from({ length: 120 }, (_, i) => ({ name: `Item ${i}`, client: 'X' }));
  const r = await sync(c, { collectionId: collection.id, records, dryRun: false });
  assert.equal(r.created.length, 120);
  assert.ok(waits.includes(2000), `waits ${waits}`);
});

test('non-retryable errors surface with status and code', async () => {
  const fake = fakeWebflow({ collection });
  const bad = new WebflowClient({ token: 'wrong', fetch: fake.fetch, sleep: noSleep });
  await assert.rejects(() => bad.getCollection(collection.id), (e) => e instanceof WebflowApiError && e.status === 401 && e.code === 'not_authorized');
});

test('retries give up after maxRetries', async () => {
  const fake = fakeWebflow({ collection, rateLimitEvery: 1 });
  await assert.rejects(() => client(fake, { maxRetries: 2 }).getCollection(collection.id), (e) => e.status === 429);
});

test('CLI: refuses to run without a token and validates flags', async () => {
  const { spawnSync } = await import('node:child_process');
  const cli = new URL('../bin/webflow-cms-sync.mjs', import.meta.url).pathname;
  const env = { ...process.env, WEBFLOW_TOKEN: '' };
  const noToken = spawnSync(process.execPath, [cli, '--collection', collection.id, '--file', 'examples/case-studies.csv'], { env });
  assert.equal(noToken.status, 2);
  assert.match(noToken.stderr.toString(), /token is required/);
  assert.equal(spawnSync(process.execPath, [cli, '--publish', '--collection', 'x', '--file', 'y'], { env }).status, 2);
});

test('a 5xx on POST is not retried (the write may already have happened), so no duplicates', async () => {
  const fake = fakeWebflow({ collection, failInsertOnce: true });
  const records = [{ name: 'Only Once', client: 'X' }];
  await assert.rejects(() => sync(client(fake), { collectionId: collection.id, records, dryRun: false }), (e) => e.status === 502);
  assert.equal(fake.store.size, 1);
  const again = await sync(client(fake), { collectionId: collection.id, records, dryRun: false });
  assert.equal(again.created.length, 0, 're-running is safe: the slug already exists');
  assert.equal(fake.store.size, 1);
});

test('values Webflow returns in a different shape are not reported as changes', () => {
  const fields = [
    { slug: 'name', type: 'PlainText', isRequired: true }, { slug: 'slug', type: 'PlainText', isRequired: true },
    { slug: 'when', type: 'DateTime' }, { slug: 'hero', type: 'Image' },
  ];
  const existing = [{ id: 'd'.repeat(24), fieldData: { name: 'A', slug: 'a', when: '2026-03-02T00:00:00Z', hero: { fileId: 'f1', url: 'https://cdn.example.com/a.jpg', alt: null } } }];
  const plan = buildPlan({ records: [{ name: 'A', when: '2026-03-02', hero: 'https://cdn.example.com/a.jpg' }], existing, fields });
  assert.equal(plan.summary.unchanged, 1);
  const changed = buildPlan({ records: [{ name: 'A', when: '2026-03-03', hero: 'https://cdn.example.com/a.jpg' }], existing, fields });
  assert.deepEqual(changed.update[0].changed, ['when']);
});
