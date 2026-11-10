// Minimal Webflow Data API v2 client. Native fetch, no SDK, so every request is visible and testable.
// Endpoints per developers.webflow.com reference (Data API v2):
//   GET   /v2/collections/{id}                 collection schema
//   GET   /v2/collections/{id}/items           staged items, limit <= 100, offset paging
//   POST  /v2/collections/{id}/items/insert    create up to 100 items
//   PATCH /v2/collections/{id}/items           update up to 100 items
//   POST  /v2/collections/{id}/items/publish   publish items by id

export const API_BASE = 'https://api.webflow.com/v2';
export const MAX_BATCH = 100;
const ID = /^[a-f0-9]{24}$/i;

export class WebflowApiError extends Error {
  constructor(status, body, path) {
    super(`Webflow API ${status} on ${path}: ${body?.message ?? 'request failed'}`);
    this.status = status;
    this.code = body?.code;
    this.details = body?.details;
  }
}

export class WebflowClient {
  /**
   * @param {object} opts
   * @param {string} opts.token     Site token or OAuth access token (never logged)
   * @param {typeof fetch} [opts.fetch]
   * @param {(ms:number)=>Promise<void>} [opts.sleep]
   * @param {number} [opts.maxRetries]
   */
  constructor({ token, fetch: f = globalThis.fetch, baseUrl = API_BASE, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), maxRetries = 5, onEvent = () => {} }) {
    if (!token) throw new Error('A Webflow API token is required (set WEBFLOW_TOKEN)');
    this.token = token;
    this.fetch = f;
    this.baseUrl = baseUrl;
    this.sleep = sleep;
    this.maxRetries = maxRetries;
    this.onEvent = onEvent;
    this.requests = 0;
  }

  static assertId(id, what = 'id') {
    if (!ID.test(String(id))) throw new TypeError(`${what} must be a 24-character hex Webflow id`);
  }

  async request(method, path, body) {
    for (let attempt = 0; ; attempt++) {
      this.requests++;
      const res = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const remaining = Number(res.headers.get('x-ratelimit-remaining'));
      // 429 means the request was rejected before processing, so any method is safe to resend.
      // A 5xx on POST may have been applied server-side; resending /items/insert could create duplicates,
      // so only idempotent methods (GET, PATCH with explicit ids) are retried on 5xx.
      const retryable = res.status === 429 || (res.status >= 500 && method !== 'POST');
      if (retryable) {
        if (attempt >= this.maxRetries) throw new WebflowApiError(res.status, await safeJson(res), path);
        const retryAfter = Number(res.headers.get('retry-after'));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(60000, 1000 * 2 ** attempt);
        this.onEvent({ type: 'retry', status: res.status, waitMs, path });
        await this.sleep(waitMs);
        continue;
      }
      const data = await safeJson(res);
      if (!res.ok) throw new WebflowApiError(res.status, data, path);
      if (Number.isFinite(remaining) && remaining <= 1) {
        // Proactive pacing: the window resets about every 60 s, so avoid tripping a 429 on the next call.
        this.onEvent({ type: 'throttle', remaining, path });
        await this.sleep(1000);
      }
      return data;
    }
  }

  getCollection(collectionId) {
    WebflowClient.assertId(collectionId, 'collectionId');
    return this.request('GET', `/collections/${collectionId}`);
  }

  async listAllItems(collectionId) {
    WebflowClient.assertId(collectionId, 'collectionId');
    const items = [];
    for (let offset = 0; ; offset += MAX_BATCH) {
      const page = await this.request('GET', `/collections/${collectionId}/items?limit=${MAX_BATCH}&offset=${offset}`);
      items.push(...(page.items ?? []));
      const total = page.pagination?.total ?? items.length;
      if (!page.items?.length || items.length >= total) return items;
    }
  }

  createItems(collectionId, entries) {
    if (entries.length > MAX_BATCH) throw new RangeError(`at most ${MAX_BATCH} items per request`);
    return this.request('POST', `/collections/${collectionId}/items/insert`, { items: entries });
  }

  updateItems(collectionId, entries) {
    if (entries.length > MAX_BATCH) throw new RangeError(`at most ${MAX_BATCH} items per request`);
    return this.request('PATCH', `/collections/${collectionId}/items`, { items: entries });
  }

  publishItems(collectionId, itemIds) {
    if (itemIds.length > MAX_BATCH) throw new RangeError(`at most ${MAX_BATCH} items per request`);
    return this.request('POST', `/collections/${collectionId}/items/publish`, { itemIds });
  }
}

async function safeJson(res) {
  try { return await res.json(); } catch { return null; }
}
