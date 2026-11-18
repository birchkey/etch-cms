import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createTestApp, ENV_ADMIN, Session } from './helpers/app';

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 1, 2, 3, 4]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 1]);

async function adminSession(t: TestApp) {
  const { session } = await t.login(ENV_ADMIN.username, ENV_ADMIN.password);
  return session;
}

async function createToken(t: TestApp, session: Session) {
  const res = await t.request('/api/tokens', { method: 'POST', cookies: session, body: { name: 'agent' } });
  expect(res.status).toBe(201);
  return ((await res.json()) as { token: string }).token;
}

async function createProductsType(t: TestApp, admin: Session) {
  const res = await t.request('/api/content-types', {
    method: 'POST', cookies: admin,
    body: {
      name: 'Products', slug: 'products',
      fields: [
        { name: 'Title', type: 'text', required: true },
        { name: 'Price', type: 'number' },
        { name: 'Photos', type: 'image', multiple: true },
      ],
    },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function connect(t: TestApp, token: string) {
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
    fetch: async (url, init) => {
      const res = await t.app.request(String(url), init, t.env, t.ctx);
      await Promise.all(t.pending.splice(0));
      return res;
    },
  });
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as { type: string; text: string }[])[0].text;
  return { isError: !!res.isError, data: JSON.parse(text) };
}

// Stands in for the internet: maps URLs to responses for the asset import fetches.
function stubRemote(routes: Record<string, () => Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    const route = routes[url];
    return route ? route() : new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('MCP endpoint', () => {
  let t: TestApp;
  let admin: Session;
  let token: string;

  beforeEach(async () => {
    t = await createTestApp();
    admin = await adminSession(t);
    token = await createToken(t, admin);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('rejects requests without an API token', async () => {
    const body = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    const res = await t.app.request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', cookie: admin.header() },
      body: JSON.stringify(body),
    }, t.env, t.ctx);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/^Bearer/);
  });

  it('rejects an unknown token', async () => {
    await expect(connect(t, 'etch_not-a-real-token')).rejects.toThrow();
  });

  it('lists the tools', async () => {
    const client = await connect(t, token);
    const { tools } = await client.listTools();
    expect(tools.map(tool => tool.name).sort()).toEqual([
      'create_entries', 'get_content_type', 'get_entry', 'import_assets_from_urls', 'list_assets',
      'list_content_types', 'list_entries', 'publish_entries', 'unpublish_entries', 'update_entry',
    ]);
  });

  it('describes a content type by slug, with decoded field options', async () => {
    await createProductsType(t, admin);
    const client = await connect(t, token);
    const { data } = await call(client, 'get_content_type', { content_type: 'products' });
    expect(data.slug).toBe('products');
    expect(data.fields).toEqual([
      { slug: 'title', name: 'Title', type: 'text', required: true },
      { slug: 'price', name: 'Price', type: 'number', required: false },
      { slug: 'photos', name: 'Photos', type: 'image', required: false, multiple: true },
    ]);
  });

  it('runs a re-runnable catalog import: assets, entries, publish', async () => {
    await createProductsType(t, admin);
    const fetchMock = stubRemote({
      'https://cdn.example.com/p/1.png': () => new Response(PNG, { headers: { 'content-type': 'image/png' } }),
      // A generic content type is resolved from the bytes.
      'https://cdn.example.com/p/2': () => new Response(JPEG, { headers: { 'content-type': 'application/octet-stream' } }),
    });
    const client = await connect(t, token);

    const imported = await call(client, 'import_assets_from_urls', {
      assets: [{ url: 'https://cdn.example.com/p/1.png', alt_text: 'Front' }, { url: 'https://cdn.example.com/p/2' }],
    });
    expect(imported.data.failed).toBe(0);
    const [one, two] = imported.data.results;
    expect(one).toMatchObject({ existing: false, value: expect.stringMatching(/^\/r2\/.+\.png$/) });
    expect(two).toMatchObject({ existing: false, value: expect.stringMatching(/^\/r2\/.+\.jpg$/) });
    expect((t.env.ASSETS_BUCKET as unknown as { objects: Map<string, unknown> }).objects.size).toBe(2);

    // Importing the same URL again returns the stored asset without fetching it.
    fetchMock.mockClear();
    const again = await call(client, 'import_assets_from_urls', { assets: [{ url: 'https://cdn.example.com/p/1.png' }] });
    expect(again.data.results[0]).toMatchObject({ id: one.id, existing: true });
    expect(fetchMock).not.toHaveBeenCalled();

    const products = [
      { slug: 'SKU 100', fields: { title: 'Lamp', price: 40, photos: [one.value, two.value] } },
      { slug: 'sku-200', fields: { price: 15 } }, // missing its required title
    ];
    const created = await call(client, 'create_entries', { content_type: 'products', entries: products, if_exists: 'update' });
    expect(created.data.results.map((r: { action: string }) => r.action)).toEqual(['created', 'created']);
    expect(created.data.results[0].slug).toBe('sku-100');

    // Running the same import again updates instead of duplicating.
    products[0].fields.price = 45;
    const rerun = await call(client, 'create_entries', { content_type: 'products', entries: products, if_exists: 'update' });
    expect(rerun.data.results.map((r: { action: string }) => r.action)).toEqual(['updated', 'updated']);
    expect(rerun.data.results[0].id).toBe(created.data.results[0].id);
    const listed = await call(client, 'list_entries', { content_type: 'products' });
    expect(listed.data.meta.total).toBe(2);

    const entry = await call(client, 'get_entry', { id: created.data.results[0].id });
    expect(entry.data.fields).toEqual({ title: 'Lamp', price: 45, photos: [one.value, two.value] });
    expect(entry.data).not.toHaveProperty('protection_password');
    expect(entry.data).not.toHaveProperty('fieldDefs');

    const ids = created.data.results.map((r: { id: string }) => r.id);
    const published = await call(client, 'publish_entries', { ids });
    expect(published.data.succeeded).toBe(1);
    expect(published.data.results[1]).toMatchObject({ id: ids[1], field_errors: { title: 'Required' } });

    // Changes are attributed to the token's owner in the activity log.
    const actions = t.db.prepare("SELECT action FROM audit_logs WHERE actor_id = ? ORDER BY created_at").all(ENV_ADMIN.username)
      .map(r => (r as { action: string }).action);
    expect(actions).toEqual(expect.arrayContaining(['asset.import', 'entry.create', 'entry.update', 'entry.publish']));
  });

  it('reports a duplicate slug by default, and can skip it', async () => {
    await createProductsType(t, admin);
    const client = await connect(t, token);
    const entries = [{ slug: 'lamp', fields: { title: 'Lamp' } }];
    await call(client, 'create_entries', { content_type: 'products', entries });

    const dup = await call(client, 'create_entries', { content_type: 'products', entries });
    expect(dup.data.results[0].error).toMatch(/Slug already in use/);
    const skipped = await call(client, 'create_entries', { content_type: 'products', entries, if_exists: 'skip' });
    expect(skipped.data.results[0].action).toBe('skipped');
  });

  it('keeps an editor to the content types they are permitted', async () => {
    const productsId = await createProductsType(t, admin);
    const other = await t.request('/api/content-types', { method: 'POST', cookies: admin, body: { name: 'Pages', slug: 'pages', fields: [] } });
    expect(other.status).toBe(201);
    const pagesId = ((await other.json()) as { id: string }).id;

    const user = await t.request('/api/users', { method: 'POST', cookies: admin, body: { username: 'ed', password: 'ed-password-1', role: 'editor' } });
    const { id: edId } = (await user.json()) as { id: string };
    await t.request(`/api/users/${edId}/permissions`, { method: 'PUT', cookies: admin, body: { contentTypeIds: [productsId] } });
    const { session } = await t.login('ed', 'ed-password-1');
    const client = await connect(t, await createToken(t, session));

    const types = await call(client, 'list_content_types');
    expect(types.data.map((ct: { id: string }) => ct.id)).toEqual([productsId]);
    const denied = await call(client, 'create_entries', { content_type: pagesId, entries: [{ fields: {} }] });
    expect(denied.isError).toBe(true);
  });
});

describe('POST /api/assets/import', () => {
  let t: TestApp;
  let token: string;

  beforeEach(async () => {
    t = await createTestApp();
    token = await createToken(t, await adminSession(t));
  });
  afterEach(() => vi.unstubAllGlobals());

  const importUrl = (url: string) => t.request('/api/assets/import', { method: 'POST', bearer: token, body: { url } });

  it.each([
    ['http://cdn.example.com/a.png', /https/],
    ['https://localhost/a.png', /public hostname/],
    ['https://10.0.0.5/a.png', /public hostname/],
    ['https://user:pw@cdn.example.com/a.png', /credentials/],
    ['not a url', /valid URL/],
  ])('refuses %s', async (url, message) => {
    const fetchMock = stubRemote({});
    const res = await importUrl(url);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(message);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a redirect to a private address', async () => {
    stubRemote({
      'https://cdn.example.com/a.png': () => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/a.png' } }),
    });
    const res = await importUrl('https://cdn.example.com/a.png');
    expect(res.status).toBe(502);
  });

  it('follows a redirect to another public URL', async () => {
    stubRemote({
      'https://cdn.example.com/a.png': () => new Response(null, { status: 301, headers: { location: '/b.png' } }),
      'https://cdn.example.com/b.png': () => new Response(PNG, { headers: { 'content-type': 'image/png' } }),
    });
    const res = await importUrl('https://cdn.example.com/a.png');
    expect(res.status).toBe(201);
    expect(((await res.json()) as { source_url: string }).source_url).toBe('https://cdn.example.com/a.png');
  });

  it('refuses content that is not an accepted file type', async () => {
    stubRemote({ 'https://cdn.example.com/page': () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }) });
    expect((await importUrl('https://cdn.example.com/page')).status).toBe(415);
  });

  it('refuses a file over the upload limit, even without a Content-Length', async () => {
    t.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('upload_limit_mb', '1')").run();
    const big = new Uint8Array(1024 * 1024 + 1);
    big.set(PNG);
    stubRemote({
      'https://cdn.example.com/big.png': () => new Response(new ReadableStream({
        start(controller) { controller.enqueue(big); controller.close(); },
      }), { headers: { 'content-type': 'image/png' } }),
    });
    expect((await importUrl('https://cdn.example.com/big.png')).status).toBe(413);
  });

  it('reports a failing source', async () => {
    stubRemote({});
    const res = await importUrl('https://cdn.example.com/missing.png');
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toBe('Source returned 404');
  });
});
