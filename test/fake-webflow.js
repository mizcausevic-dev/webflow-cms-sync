// In-memory stand-in for the Webflow Data API v2 endpoints this tool uses, including 429 rate limiting.
let seq = 0;
const newId = () => (0xabc000000000 + ++seq).toString(16).padStart(24, '0');

export function fakeWebflow({ collection, items = [], rateLimitEvery = 0 }) {
  const store = new Map(items.map((i) => [i.id, structuredClone(i)]));
  const log = [];
  let calls = 0;
  const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '50', ...headers } });

  const fetch = async (url, init = {}) => {
    calls++;
    const u = new URL(url);
    const method = init.method ?? 'GET';
    log.push(`${method} ${u.pathname}${u.search}`);
    if (init.headers?.Authorization !== 'Bearer test-token') return json(401, { code: 'not_authorized', message: 'bad token' });
    if (rateLimitEvery && calls % rateLimitEvery === 0) return json(429, { code: 'too_many_requests', message: 'slow down' }, { 'retry-after': '2' });
    const base = `/v2/collections/${collection.id}`;
    const body = init.body ? JSON.parse(init.body) : null;
    if (method === 'GET' && u.pathname === base) return json(200, collection);
    if (method === 'GET' && u.pathname === `${base}/items`) {
      const limit = Number(u.searchParams.get('limit') ?? 100), offset = Number(u.searchParams.get('offset') ?? 0);
      if (limit > 100) return json(400, { code: 'validation_error', message: 'limit > 100' });
      const all = [...store.values()];
      return json(200, { items: all.slice(offset, offset + limit), pagination: { limit, offset, total: all.length } });
    }
    if (method === 'POST' && u.pathname === `${base}/items/insert`) {
      if (body.items.length > 100) return json(400, { code: 'batch_too_large', message: '> 100' });
      const created = body.items.map((e) => { const it = { id: newId(), fieldData: e.fieldData, isDraft: e.isDraft ?? true, isArchived: false }; store.set(it.id, it); return it; });
      return json(202, { items: created });
    }
    if (method === 'PATCH' && u.pathname === `${base}/items`) {
      if (body.items.length > 100) return json(400, { code: 'batch_too_large', message: '> 100' });
      const updated = body.items.map((e) => { const it = store.get(e.id); it.fieldData = { ...it.fieldData, ...e.fieldData }; return it; });
      return json(200, { items: updated });
    }
    if (method === 'POST' && u.pathname === `${base}/items/publish`) {
      const ok = body.itemIds.filter((id) => store.has(id));
      ok.forEach((id) => { store.get(id).isDraft = false; });
      return json(202, { publishedItemIds: ok, errors: [] });
    }
    return json(404, { code: 'resource_not_found', message: `${method} ${u.pathname}` });
  };
  return { fetch, store, log, get calls() { return calls; } };
}
