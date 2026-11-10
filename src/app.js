import { parseCsv } from './csv.js';
import { buildPlan, chunk } from './plan.js';

const $ = (id) => document.getElementById(id);
const MAX_CHARS = 500_000;

const EXISTING = [
  { id: '6650a1b2c3d4e5f6a7b8c9d1', fieldData: { name: 'Checkout Redesign', slug: 'checkout-redesign', client: 'Northwind Pay', industry: 'opt-fin', 'conversion-lift': 15 } },
  { id: '6650a1b2c3d4e5f6a7b8c9d2', fieldData: { name: 'Patient Portal Migration', slug: 'patient-portal-migration', client: 'Harbor Health', industry: 'opt-health', 'conversion-lift': 9, featured: false, 'published-on': '2026-04-17T00:00:00.000Z', 'live-url': 'https://example.com/harbor' } },
  { id: '6650a1b2c3d4e5f6a7b8c9d3', fieldData: { name: 'Legacy Rebrand', slug: 'legacy-rebrand', client: 'Umbrella Corp' } },
];

function el(tag, attrs = {}, text) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
}

function pill(cls, text) { return el('span', { class: `pill ${cls}` }, text); }

function render() {
  const err = $('err');
  err.textContent = '';
  let plan, collection;
  try {
    for (const id of ['csv', 'schema', 'existing']) if ($(id).value.length > MAX_CHARS) throw new RangeError(`${id} is larger than ${MAX_CHARS} characters`);
    collection = JSON.parse($('schema').value);
    const existing = JSON.parse($('existing').value);
    if (!Array.isArray(collection.fields)) throw new TypeError('schema needs a "fields" array');
    if (!Array.isArray(existing)) throw new TypeError('existing items must be an array');
    plan = buildPlan({ records: parseCsv($('csv').value), existing, fields: collection.fields });
  } catch (e) {
    err.textContent = e.message;
    return;
  }
  const s = plan.summary;
  const tiles = $('tiles');
  tiles.replaceChildren();
  for (const [k, v, sub] of [['Create', s.create, 'new items'], ['Update', s.update, `${s.unchanged} unchanged`], ['Invalid', s.invalid + s.duplicates, 'blocked before the API'], ['Only in Webflow', s.orphans, 'reported, never deleted']]) {
    const t = el('div', { class: 'tile' });
    t.append(el('div', { class: 'k' }, k), el('div', { class: 'v' }, String(v)), el('div', { class: 's' }, sub));
    tiles.append(t);
  }
  const body = $('plan').querySelector('tbody');
  body.replaceChildren();
  const add = (row, action, slug, detail) => {
    const tr = el('tr');
    const a = el('td'); a.append(action);
    const d = el('td');
    if (Array.isArray(detail)) { const ul = el('ul', { class: 'err-list' }); detail.forEach((x) => ul.append(el('li', {}, x))); d.append(ul); } else d.textContent = detail;
    tr.append(el('td', {}, row), a, el('td', {}, slug ?? '—'), d);
    body.append(tr);
  };
  plan.create.forEach((p) => add(String(p.row), pill('ok', 'create'), p.fieldData.slug, `${Object.keys(p.fieldData).length} fields`));
  plan.update.forEach((p) => add(String(p.row), pill('info', 'update'), p.fieldData.slug, `changed: ${p.changed.join(', ')}`));
  plan.unchanged.forEach((p) => add(String(p.row), pill('muted', 'unchanged'), p.slug, 'already up to date'));
  plan.invalid.forEach((p) => add(String(p.row), pill('danger', 'invalid'), p.slug, p.errors));
  plan.duplicates.forEach((p) => add(String(p.row), pill('warn', 'duplicate'), p.slug, 'slug already used by an earlier row'));
  plan.orphans.forEach((p) => add('—', pill('warn', 'only in Webflow'), p.slug, 'left untouched'));

  const id = collection.id ?? '{collection_id}';
  const reqs = [];
  chunk(plan.create, 100).forEach((b) => reqs.push(`POST /v2/collections/${id}/items/insert\n${JSON.stringify({ items: b.map((p) => ({ fieldData: p.fieldData, isDraft: true })) }, null, 2)}`));
  chunk(plan.update, 100).forEach((b) => reqs.push(`PATCH /v2/collections/${id}/items\n${JSON.stringify({ items: b.map((p) => ({ id: p.id, fieldData: p.fieldData })) }, null, 2)}`));
  $('requests').textContent = reqs.length ? reqs.join('\n\n') : 'Nothing to send: the collection is already in sync.';
}

async function init() {
  try {
    const [schema, csv] = await Promise.all([fetch('examples/collection.json').then((r) => r.text()), fetch('examples/case-studies.csv').then((r) => r.text())]);
    $('schema').value = schema;
    $('csv').value = csv;
  } catch {
    $('err').textContent = 'Could not load the examples. Serve this folder over HTTP.';
  }
  $('existing').value = JSON.stringify(EXISTING, null, 2);
  document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[data-tab]').forEach((x) => { x.setAttribute('aria-selected', String(x === b)); $(x.dataset.tab).hidden = x !== b; });
  }));
  let t;
  for (const id of ['csv', 'schema', 'existing']) $(id).addEventListener('input', () => { clearTimeout(t); t = setTimeout(render, 200); });
  render();
}

init();
