// Validates and coerces source records into Webflow CMS fieldData using the collection's field schema
// (GET /v2/collections/{collection_id} -> fields[{ slug, type, isRequired, validations }]).

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function slugify(s) {
  return String(s ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 256);
}

function isUrl(v) {
  try { const u = new URL(v); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; }
}

/** Coerces one value for a field type. Returns { value } or { error }. */
export function coerce(field, raw) {
  const v = typeof raw === 'string' ? raw.trim() : raw;
  if (v === '' || v === null || v === undefined) return { value: undefined };
  switch (field.type) {
    case 'PlainText':
    case 'RichText': {
      const s = String(v);
      const max = field.validations?.maxLength;
      if (max && s.length > max) return { error: `longer than ${max} characters` };
      return { value: s };
    }
    case 'Number': {
      const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
      return Number.isFinite(n) ? { value: n } : { error: `"${v}" is not a number` };
    }
    case 'Switch': {
      if (typeof v === 'boolean') return { value: v };
      const s = String(v).toLowerCase();
      if (['true', 'yes', '1', 'on'].includes(s)) return { value: true };
      if (['false', 'no', '0', 'off'].includes(s)) return { value: false };
      return { error: `"${v}" is not a boolean` };
    }
    case 'DateTime': {
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? { error: `"${v}" is not a date` } : { value: d.toISOString() };
    }
    case 'Email':
      return EMAIL.test(String(v)) ? { value: String(v) } : { error: `"${v}" is not an email` };
    case 'Link':
    case 'VideoLink':
      return isUrl(String(v)) ? { value: String(v) } : { error: `"${v}" is not an http(s) URL` };
    case 'Color':
      return HEX.test(String(v)) ? { value: String(v) } : { error: `"${v}" is not a hex color` };
    case 'Option': {
      const options = field.validations?.options ?? [];
      const hit = options.find((o) => o.id === v || o.name?.toLowerCase() === String(v).toLowerCase());
      return hit ? { value: hit.id } : { error: `"${v}" is not one of: ${options.map((o) => o.name).join(', ')}` };
    }
    case 'Image':
      return isUrl(String(v)) ? { value: { url: String(v) } } : { error: `"${v}" is not an image URL` };
    default:
      return { value: v };
  }
}

/**
 * Converts a source record (keys = field slugs) to fieldData.
 * Unknown keys are reported, required fields enforced, slug derived from name when absent.
 */
export function toFieldData(record, fields) {
  const bySlug = new Map(fields.map((f) => [f.slug, f]));
  const fieldData = {};
  const errors = [];
  for (const [key, raw] of Object.entries(record)) {
    const field = bySlug.get(key);
    if (!field) { if (String(raw ?? '').trim() !== '') errors.push(`unknown field "${key}"`); continue; }
    if (field.isEditable === false) continue;
    const r = coerce(field, raw);
    if (r.error) errors.push(`${key}: ${r.error}`);
    else if (r.value !== undefined) fieldData[key] = r.value;
  }
  if (!fieldData.slug && fieldData.name) fieldData.slug = slugify(fieldData.name);
  if (fieldData.slug && fieldData.slug !== slugify(fieldData.slug)) errors.push(`slug: "${fieldData.slug}" is not a valid slug (try "${slugify(fieldData.slug)}")`);
  for (const f of fields) {
    if (f.isRequired && fieldData[f.slug] === undefined) errors.push(`${f.slug}: required`);
  }
  return { fieldData, errors };
}
