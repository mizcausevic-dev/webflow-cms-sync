import { buildPlan, chunk } from './plan.js';
import { MAX_BATCH } from './client.js';

/**
 * Plans and (unless dryRun) applies a sync: creates and updates in batches of 100, optionally publishes.
 * Invalid rows never reach the API. Orphans (in Webflow but not in the source) are reported, never deleted.
 */
export async function sync(client, { collectionId, records, dryRun = true, publish = false, draft = true }) {
  const collection = await client.getCollection(collectionId);
  const existing = await client.listAllItems(collectionId);
  const plan = buildPlan({ records, existing, fields: collection.fields ?? [] });
  const result = { plan, created: [], updated: [], published: [], publishErrors: [], dryRun };
  if (dryRun) return result;

  for (const batch of chunk(plan.create, MAX_BATCH)) {
    const res = await client.createItems(collectionId, batch.map((p) => ({ fieldData: p.fieldData, isDraft: draft && !publish })));
    result.created.push(...(res.items ?? []).map((i) => i.id));
  }
  for (const batch of chunk(plan.update, MAX_BATCH)) {
    const res = await client.updateItems(collectionId, batch.map((p) => ({ id: p.id, fieldData: p.fieldData })));
    result.updated.push(...(res.items ?? []).map((i) => i.id));
  }
  if (publish) {
    const ids = [...result.created, ...result.updated];
    for (const batch of chunk(ids, MAX_BATCH)) {
      const res = await client.publishItems(collectionId, batch);
      result.published.push(...(res.publishedItemIds ?? []));
      result.publishErrors.push(...(res.errors ?? []));
    }
  }
  return result;
}
