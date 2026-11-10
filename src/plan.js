// Pure diff: what a sync would do, before any network write happens.
import { toFieldData } from './schema.js';

function stable(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return JSON.stringify(Object.keys(v).sort().map((k) => [k, stable(v[k])]));
  return JSON.stringify(v);
}

// Webflow returns some field values in a richer or differently formatted shape than we send:
// DateTime may come back with or without milliseconds, Image as { fileId, url, alt }. Compare by meaning, not bytes,
// or every re-run would "update" unchanged items.
function comparable(type, v) {
  if (v === null || v === undefined || v === '') return null;
  if (type === 'DateTime') { const t = new Date(v).getTime(); return Number.isNaN(t) ? v : t; }
  if (type === 'Image') return typeof v === 'object' ? v.url ?? null : v;
  if (type === 'Number') return Number(v);
  return v;
}

/** Fields present in `next` whose value differs from `current`. Only source-provided fields are compared. */
export function changedFields(current, next, types = {}) {
  return Object.keys(next).filter((k) => stable(comparable(types[k], current?.[k])) !== stable(comparable(types[k], next[k])));
}

export function buildPlan({ records, existing, fields }) {
  const bySlug = new Map(existing.map((item) => [item.fieldData?.slug, item]));
  const types = Object.fromEntries(fields.map((f) => [f.slug, f.type]));
  const seen = new Set();
  const plan = { create: [], update: [], unchanged: [], invalid: [], duplicates: [], orphans: [] };
  records.forEach((record, row) => {
    const { fieldData, errors } = toFieldData(record, fields);
    if (errors.length) { plan.invalid.push({ row: row + 1, slug: fieldData.slug ?? null, errors }); return; }
    if (seen.has(fieldData.slug)) { plan.duplicates.push({ row: row + 1, slug: fieldData.slug }); return; }
    seen.add(fieldData.slug);
    const current = bySlug.get(fieldData.slug);
    if (!current) { plan.create.push({ row: row + 1, fieldData }); return; }
    const changed = changedFields(current.fieldData, fieldData, types);
    if (changed.length) plan.update.push({ row: row + 1, id: current.id, fieldData, changed });
    else plan.unchanged.push({ row: row + 1, id: current.id, slug: fieldData.slug });
  });
  for (const item of existing) if (!seen.has(item.fieldData?.slug)) plan.orphans.push({ id: item.id, slug: item.fieldData?.slug });
  plan.summary = Object.fromEntries(['create', 'update', 'unchanged', 'invalid', 'duplicates', 'orphans'].map((k) => [k, plan[k].length]));
  return plan;
}

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
