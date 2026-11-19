import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeOpenApi } from '../../scripts/docs/normalize-openapi.mjs';
import { renderSite } from '../../scripts/docs/openapi-to-html.mjs';
import { ids, openapi, ref } from './helpers.mjs';

const operation = (operationId, extra = {}) => ({ operationId, responses: {}, ...extra });
const withOperations = (list) => openapi({
  paths: Object.fromEntries(list.map((op, index) => [`/p${index}`, { get: op }])),
});
const urls = (model) => Object.fromEntries(model.operations.map((op) => [op.operationId, op.url]));

test('operation routes are extensionless, version-scoped and independent of tags, summaries and order', () => {
  const list = [
    operation('getPublishStatus', { tags: ['publish'] }),
    operation('updateConfigSite', { summary: 'Update site' }),
  ];
  const model = normalizeOpenApi(withOperations(list), { version: 'admin' });
  assert.deepEqual(urls(model), {
    getPublishStatus: '/docs/admin/get-publish-status',
    updateConfigSite: '/docs/admin/update-config-site',
  });
  const files = renderSite(withOperations(list), { version: 'admin' });
  assert.ok(files['get-publish-status/index.html'] && files['update-config-site/index.html']);
  const renamed = list.map((op) => ({ ...op, tags: ['different'], summary: 'Renamed' }));
  assert.deepEqual(urls(normalizeOpenApi(withOperations(renamed), { version: 'admin' })), urls(model));
  assert.deepEqual(urls(normalizeOpenApi(withOperations([...list].reverse()), { version: 'admin' })), urls(model));
  assert.equal(
    urls(normalizeOpenApi(withOperations([operation('getSourceDocument')]), { version: 'api' })).getSourceDocument,
    '/docs/api/get-source-document',
  );
});

test('names convert acronyms explicitly and reject invalid, duplicate, lossy and reserved names', () => {
  assert.equal(
    urls(normalizeOpenApi(withOperations([operation('getHTTPStatus')]), { version: 'admin' })).getHTTPStatus,
    '/docs/admin/get-http-status',
  );
  assert.equal(
    normalizeOpenApi(openapi({ schemas: { CDNConfig: {} } }), { version: 'admin' }).schemaNames.CDNConfig.url,
    '/docs/admin/schemas/cdn-config',
  );
  [undefined, null, 4, '', ' ', ' status', 'status ', '---'].forEach((operationId) => {
    assert.throws(() => normalizeOpenApi(withOperations([operation(operationId)]), { version: 'admin' }), /usable slug/, String(operationId));
  });
  assert.throws(
    () => normalizeOpenApi(withOperations([operation('status'), operation('status')]), { version: 'admin' }),
    /Duplicate operationId/,
  );
  [['getURL', 'getUrl'], ['getThing', 'get-thing'], ['get_thing', 'get-thing']].forEach((pair) => {
    assert.throws(
      () => normalizeOpenApi(withOperations(pair.map((id) => operation(id))), { version: 'admin' }),
      /Operation slug collision/,
      pair.join(' / '),
    );
  });
  assert.throws(() => normalizeOpenApi(withOperations([operation('schemas')]), { version: 'admin' }), /reserved name/);
});

test('alias chains share one canonical page named by the single public alias', () => {
  const schemas = {
    site: { type: 'object' },
    SiteConfig: { ...ref('site'), 'x-tags': ['siteConfig'] },
    SiteAlias: ref('SiteConfig'),
    cdn: { type: 'object' },
    CDNConfig: { ...ref('cdn'), 'x-tags': ['siteConfig'] },
    Separate: { type: 'object' },
  };
  const route = (input, version = 'admin') => Object.fromEntries(
    Object.entries(normalizeOpenApi(input, { version }).schemaNames)
      .map(([name, entry]) => [name, entry.url]),
  );
  const routes = route(openapi({ schemas }));
  ['site', 'SiteConfig', 'SiteAlias'].forEach((name) => assert.equal(routes[name], '/docs/admin/schemas/site-config', name));
  ['cdn', 'CDNConfig'].forEach((name) => assert.equal(routes[name], '/docs/admin/schemas/cdn-config', name));
  assert.equal(routes.Separate, '/docs/admin/schemas/separate');
  assert.equal(normalizeOpenApi(openapi({ schemas }), { version: 'admin' }).schemas.length, 3);
  const reversed = Object.fromEntries(Object.entries(schemas).reverse());
  assert.deepEqual(route(openapi({ schemas: reversed })), routes);
  assert.equal(route(openapi({ schemas }), 'api').site, '/docs/api/schemas/site-config');
  const files = renderSite(openapi({ schemas }), { version: 'admin' });
  assert.ok(files['schemas/site-config/index.html']);
  assert.ok(!files['schemas/site/index.html'] && !files['schemas/site-alias/index.html']);
});

test('schema validation rejects missing and external targets, cycles, ambiguity and slug problems', () => {
  [
    [{ A: ref('Missing') }, /Unresolved reference/],
    [{ A: ref('B'), B: ref('A') }, /alias-only cycle/],
    [{ A: { $ref: './external.json' } }, /bundled local JSON pointer/],
    [{
      base: {},
      First: { ...ref('base'), 'x-tags': ['siteConfig'] },
      Second: { ...ref('base'), 'x-tags': ['siteConfig'] },
    }, /Ambiguous AEM public aliases/],
    [{ CDNConfig: {}, CdnConfig: {} }, /Schema slug collision/],
    [{ '---': {} }, /usable slug/],
  ].forEach(([schemas, error]) => {
    assert.throws(() => normalizeOpenApi(openapi({ schemas }), { version: 'admin' }), error, Object.keys(schemas).join(', '));
  });
});

test('a reference with constraint siblings keeps its own page; self-reference stays one page', () => {
  const constrained = normalizeOpenApi(openapi({
    schemas: { Base: { type: 'object' }, Constrained: { ...ref('Base'), required: ['id'] } },
  }), { version: 'admin' });
  assert.equal(constrained.schemas.length, 2);
  assert.notEqual(constrained.schemaNames.Base.url, constrained.schemaNames.Constrained.url);
  const recursive = normalizeOpenApi(openapi({
    schemas: { Node: { properties: { child: ref('Node') } } },
  }), { version: 'admin' });
  assert.equal(recursive.schemas.length, 1);
});

test('generated field anchors separate nesting, literal punctuation, arrays, dictionaries and patterns', () => {
  const string = { type: 'string' };
  const files = renderSite(openapi({
    schemas: {
      Root: {
        type: 'object',
        properties: {
          a: { type: 'object', properties: { b: string } },
          'a.b': string,
          'a-b': string,
          items: { type: 'array', items: { type: 'object', properties: { sku: string } } },
          'items[]': { type: 'object', properties: { sku: string } },
          metadata: { type: 'object', properties: { '*': string }, additionalProperties: string },
          headers: {
            type: 'object',
            patternProperties: {
              '^/[a-z]*$': { type: 'object', properties: { value: string } },
              '^[a-z]+$': { type: 'object', properties: { value: string } },
            },
          },
          'a"b': string,
          'a\\b': string,
          'a b': string,
          'a\\u0020b': string,
          '': string,
        },
      },
    },
  }), { version: 'admin' });
  const targets = ids(files['schemas/root/index.html']);
  const expected = [
    'field-a.b', 'field-["a.b"]', 'field-a-b',
    'field-items[].sku', 'field-["items[]"].sku',
    'field-metadata.*', 'field-metadata["*"]',
    'field-headers[pattern="^/[a-z]*$"].value', 'field-headers[pattern="^[a-z]+$"].value',
    'field-["a\\"b"]', 'field-["a\\\\b"]', 'field-["a\\u0020b"]', 'field-["a\\\\u0020b"]',
    'field-[""]',
  ];
  expected.forEach((id) => assert.ok(targets.includes(id), `missing ${id}`));
  assert.equal(new Set(targets).size, targets.length);
  targets.forEach((id) => {
    assert.ok(!/\s/.test(id), id);
    assert.equal(decodeURIComponent(encodeURIComponent(id)), id);
  });
});

test('anchors that collide across contexts fail generation instead of duplicating IDs', () => {
  const string = { type: 'string' };
  const object = (name) => ({ type: 'object', properties: { [name]: string } });
  [
    [{
      parameters: [
        { in: 'query', name: 'a-b', schema: string },
        { in: 'query', name: 'a', schema: object('b') },
      ],
    }, /Duplicate generated ID query-a-b/],
    [{
      requestBody: {
        content: {
          'application/json': { schema: object('x') },
          'application/json-x': { schema: string },
        },
      },
    }, /Duplicate generated ID request-body-application-json-x/],
  ].forEach(([extra, error]) => {
    assert.throws(() => renderSite(withOperations([operation('collide', extra)]), { version: 'admin' }), error);
  });
});

test('anchor contexts separate parameter location, response status and media type', () => {
  const body = { schema: { type: 'object', properties: { id: { type: 'string' } } } };
  const content = { 'application/json': body, 'text/yaml': body };
  const input = openapi({
    paths: {
      '/{org}': {
        post: operation('makeThing', {
          parameters: [
            {
              name: 'org', in: 'path', required: true, schema: { type: 'string' },
            },
            { name: 'org', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
          ],
          requestBody: { content },
          responses: { 200: { description: 'OK', content }, 201: { description: 'Created', content } },
        }),
      },
    },
  });
  const targets = ids(renderSite(input, { version: 'admin' })['make-thing/index.html']);
  [
    'path-org', 'query-org', 'query-limit', 'request-body', 'response-200', 'response-201',
    ...['request-body', 'response-200-body', 'response-201-body'].flatMap((context) => [
      `${context}-application-json`, `${context}-text-yaml`,
      `${context}-application-json-id`, `${context}-text-yaml-id`,
    ]),
  ].forEach((id) => assert.ok(targets.includes(id), `missing ${id}`));
  assert.equal(new Set(targets).size, targets.length);
});

test('media labels are order-independent, name wildcards and reject collisions', () => {
  const contexts = (types) => normalizeOpenApi(openapi({
    paths: {
      '/x': {
        post: operation('makeThing', {
          requestBody: { content: Object.fromEntries(types.map((type) => [type, {}])) },
        }),
      },
    },
  }), { version: 'admin' }).operations[0].requestBody.media.map((entry) => entry.context);
  assert.equal(contexts(['application/json'])[0], contexts(['text/yaml', 'application/json'])[1]);
  assert.deepEqual(contexts(['*/*', 'application/*']), ['request-body-any', 'request-body-application-any']);
  assert.throws(() => contexts(['application/*', 'application/any']), /Media slug collision/);
  assert.throws(() => contexts(['application/json', 'application-json']), /Media slug collision/);
});
