// Pure diff: what a sync would do, before any network write happens.
import { toFieldData } from './schema.js';

function stable(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return JSON.stringify(Object.keys(v).sort().map((k) => [k, stable(v[k])]));
  return JSON.stringify(v);
}

/** Fields present in `next` whose value differs from `current`. Only source-provided fields are compared. */
export function changedFields(current, next) {
  return Object.keys(next).filter((k) => stable(current?.[k]) !== stable(next[k]));
}

export function buildPlan({ records, existing, fields }) {
  const bySlug = new Map(existing.map((item) => [item.fieldData?.slug, item]));
  const seen = new Set();
  const plan = { create: [], update: [], unchanged: [], invalid: [], duplicates: [], orphans: [] };
  records.forEach((record, row) => {
    const { fieldData, errors } = toFieldData(record, fields);
    if (errors.length) { plan.invalid.push({ row: row + 1, slug: fieldData.slug ?? null, errors }); return; }
    if (seen.has(fieldData.slug)) { plan.duplicates.push({ row: row + 1, slug: fieldData.slug }); return; }
    seen.add(fieldData.slug);
    const current = bySlug.get(fieldData.slug);
    if (!current) { plan.create.push({ row: row + 1, fieldData }); return; }
    const changed = changedFields(current.fieldData, fieldData);
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
