import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeOpenApi } from '../../scripts/docs/normalize-openapi.mjs';
import { accessSchema, bulkPublishBody, sourceOperations } from './aem-fixtures.mjs';
import { bundles, readBundle } from './helpers.mjs';

function document(operation = {}, components = {}) {
  return {
    openapi: '3.1.0',
    info: { title: 'AEM Admin API', version: 'test' },
    tags: [{ name: 'source', 'x-displayName': 'Source documents' }],
    'x-tagGroups': [{ name: 'Authoring', tags: ['source'] }],
    servers: [{ url: 'https://api.aem.live' }],
    paths: {
      '/source': {
        post: { operationId: 'makeThing', tags: ['source'], ...operation },
      },
    },
    components,
  };
}
const normalize = (doc) => normalizeOpenApi(doc, { version: 'api' });
const node = (model, pointer) => model.nodes[pointer];

test('exposes component-reference boundaries and response-specific media contexts', () => {
  const header = { content: { 'application/json': { schema: { type: 'string' } } } };
  const input = document({
    responses: { 200: { headers: { etag: header } }, 201: { headers: { etag: header } } },
    parameters: [{ in: 'query', name: 'a b', schema: {} }],
  }, {
    schemas: {
      Root: {
        properties: {
          named: { $ref: '#/components/schemas/Other' },
          local: { $ref: '#/components/schemas/Root/$defs/Local' },
        },
        $defs: { Local: { type: 'string' } },
      },
      Other: { type: 'object' },
    },
  });
  const model = normalize(input);
  assert.equal(node(model, '#/components/schemas/Root/properties/named').reference.component, true);
  assert.equal(node(model, '#/components/schemas/Root/properties/local').reference.component, false);
  assert.equal(model.operations[0].parameters[0].context, 'query-["a\\u0020b"]');
  assert.deepEqual(
    model.operations[0].responses.map((response) => response.headers[0].media[0].context),
    ['response-200-header-etag-application-json', 'response-201-header-etag-application-json'],
  );
});

test('normalizes AEM aliases, nested arrays, requiredness, defaults and deprecation', () => {
  const input = document({}, {
    schemas: {
      'access-site': accessSchema,
      SiteAccessConfig: { $ref: '#/components/schemas/access-site', 'x-tags': ['siteConfig'] },
      bulkPublishBody,
    },
  });
  const before = structuredClone(input);
  const model = normalize(input);
  assert.deepEqual(input, before);
  assert.equal(model.schemaNames.SiteAccessConfig, model.schemaNames['access-site']);
  assert.equal(model.schemaNames.SiteAccessConfig.url, '/docs/api/schemas/site-access-config');
  const access = node(model, model.schemaNames.SiteAccessConfig.source);
  const deprecated = node(model, access.properties.find((p) => p.name === 'apiKeyId').schema);
  assert.equal(deprecated.metadata.deprecated, true);
  assert.equal(node(model, deprecated.items).metadata.type, 'string');
  assert.equal(node(model, access.additionalProperties).boolean, false);
  const body = node(model, '#/components/schemas/bulkPublishBody');
  assert.equal(body.properties.find((p) => p.name === 'paths').required, true);
  assert.equal(body.properties.find((p) => p.name === 'delete').required, false);
  assert.equal(node(model, '#/components/schemas/bulkPublishBody/properties/delete')
    .metadata.default, false);
  assert.equal(model.operations[0].url, '/docs/api/make-thing');
  assert.equal(model.tags[0].displayName, 'Source documents');
  assert.equal(model.tags[0].anchor, 'source');
  assert.deepEqual(model.tagGroups, [{ name: 'Authoring', tags: ['source'], anchor: 'authoring' }]);
  assert.doesNotThrow(() => JSON.stringify(model));
});

test('normalizes selected API Service source media and headers without request synthesis', () => {
  const input = document({}, {
    securitySchemes: { AuthCookie: { type: 'apiKey', in: 'cookie', name: 'auth_token' } },
  });
  input.paths = { '/{org}/sites/{site}/source/{path}': sourceOperations };
  const model = normalize(input);
  const [get, put] = model.operations;
  assert.equal(get.url, '/docs/api/get-source-document');
  assert.equal(get.responses[0].media[0].context, 'response-200-body-any');
  assert.equal(node(model, get.responses[0].media[0].schema).metadata.format, 'binary');
  assert.equal(get.responses[0].headers[0].name, 'etag');
  assert.equal(get.responses[0].headers[0].context, 'response-200-header-etag');
  assert.equal(put.requestBody.required, false);
  assert.deepEqual(put.requestBody.media[0].examples, []);
  assert.equal(model.diagnostics[0].code, 'non-oauth-scopes');
  assert.deepEqual(get.security.alternatives[0].schemes[0].scopes, ['preview:read']);
});

test('normalizes the existing AEM permission display extension without using raw operations', () => {
  const model = normalize(document({ 'x-permissions': ['preview:read', 'publish:write'] }));
  assert.deepEqual(model.operations[0].permissions, ['preview:read', 'publish:write']);
  assert.deepEqual(normalize(document()).operations[0].permissions, []);
  assert.throws(
    () => normalize(document({ 'x-permissions': 'preview:read' })),
    /post\/x-permissions: Expected permission strings/,
  );
});

test('parameter overrides use location and exact name, retaining source context', () => {
  const input = document({
    parameters: [
      { in: 'query', name: 'limit', schema: { type: 'integer', default: 0 } },
      { in: 'header', name: 'limit', schema: { type: 'string' } },
    ],
  });

  input.paths['/source'].parameters = [
    { in: 'query', name: 'limit', schema: { type: 'integer', default: 10 } },
    {
      in: 'path', name: 'org', required: true, schema: { type: 'string' },
    },
  ];
  const model = normalize(input);
  const params = model.operations[0].parameters;
  assert.equal(params.length, 3);
  assert.equal(
    params.find((p) => p.in === 'query').source,
    '#/paths/~1source/post/parameters/0',
  );
  assert.equal(node(model, params.find((p) => p.in === 'query').schema).metadata.default, 0);
  assert.equal(params.find((p) => p.in === 'path').source, '#/paths/~1source/parameters/1');
  const duplicate = structuredClone(input);
  duplicate.paths['/source'].post.parameters.push(duplicate.paths['/source'].post.parameters[0]);
  assert.throws(() => normalize(duplicate), /post\/parameters\/2: Duplicate parameter query limit/);
});

test('security preserves root inheritance, AND/OR, anonymous alternatives and explicit empty overrides', () => {
  const input = document({}, {
    securitySchemes: {
      Cookie: { type: 'apiKey', in: 'cookie', name: 'auth_token' },
      Token: { type: 'http', scheme: 'bearer' },
    },
  });
  input.security = [{ Cookie: [], Token: [] }, {}];
  const { security } = normalize(input).operations[0];
  assert.equal(security.source, '#/security');
  assert.equal(security.alternatives[0].schemes.length, 2);
  assert.equal(security.alternatives[1].anonymous, true);
  input.paths['/source'].post.security = [];
  assert.deepEqual(
    normalize(input).operations[0].security.alternatives,
    [{ anonymous: true, schemes: [] }],
  );
  delete input.security;
  delete input.paths['/source'].post.security;
  assert.equal(normalize(input).operations[0].security.declared, false);
  input.paths['/source'].post.security = [{ Missing: [] }];
  assert.throws(() => normalize(input), /post\/security\/0: Unknown security scheme Missing/);
});

test('resolves parameter/body/response/header/example references and keeps false/null examples', () => {
  const input = document({
    parameters: [{ $ref: '#/components/parameters/limit' }],
    requestBody: { $ref: '#/components/requestBodies/body' },
    responses: { 200: { $ref: '#/components/responses/ok', description: 'At this operation' } },
  }, {
    parameters: {
      limit: {
        in: 'query', name: 'limit', schema: { type: 'integer' }, example: 0,
      },
    },
    requestBodies: {
      body: { required: true, content: { 'application/json': { example: false } } },
    },
    responses: {
      ok: {
        description: 'Shared',
        headers: { etag: { $ref: '#/components/headers/etag' } },
        content: {
          'text/yaml': {
            schema: { type: 'string' },
            examples: { empty: { $ref: '#/components/examples/empty' } },
          },
        },
      },
    },
    headers: { etag: { description: 'Entity tag', schema: { type: 'string' } } },
    examples: { empty: { value: null, summary: 'Empty YAML' } },
  });
  const model = normalize(input);
  const operation = model.operations[0];
  assert.equal(operation.parameters[0].definitionSource, '#/components/parameters/limit');
  assert.equal(operation.parameters[0].examples[0].value, 0);
  assert.equal(operation.requestBody.required, true);
  assert.equal(operation.requestBody.media[0].examples[0].value, false);
  assert.equal(operation.responses[0].description, 'At this operation');
  assert.equal(operation.responses[0].headers[0].description, 'Entity tag');
  assert.equal(operation.responses[0].media[0].examples[0].value, null);
  assert.equal(
    operation.responses[0].media[0].examples[0].definitionSource,
    '#/components/examples/empty',
  );
});

test('composition branches retain conflicting fields and branch-specific requirements', () => {
  const model = normalize(document({}, {
    schemas: {
      Result: {
        allOf: [
          { required: ['id'], properties: { id: { type: 'string' } } },
          { properties: { id: { type: 'integer' } } },
        ],
        oneOf: [
          { required: ['name'], properties: { name: { type: 'string' } } },
          { required: ['code'], properties: { code: { enum: [0, 1] } } },
        ],
        anyOf: [{ type: 'null' }, { type: 'string' }],
        not: { required: ['invalid'] },
        dependentRequired: { code: ['name'] },
      },
    },
  }));
  const result = node(model, '#/components/schemas/Result');
  assert.equal(result.properties.length, 0);
  assert.equal(node(model, result.allOf[0]).properties[0].required, true);
  assert.equal(node(model, result.allOf[1]).properties[0].required, false);
  assert.equal(node(model, node(model, result.allOf[0]).properties[0].schema).metadata.type, 'string');
  assert.equal(node(model, node(model, result.allOf[1]).properties[0].schema).metadata.type, 'integer');
  assert.deepEqual(node(model, result.oneOf[0]).metadata.required, ['name']);
  assert.deepEqual(node(model, result.oneOf[1]).metadata.required, ['code']);
  assert.equal(result.anyOf.length, 2);
  assert.deepEqual(node(model, result.not).metadata.required, ['invalid']);
  assert.deepEqual(result.metadata.dependentRequired, { code: ['name'] });
});

test('cycles and reference siblings remain finite graph edges, with canonical links', () => {
  const model = normalize(document({}, {
    schemas: {
      Node: {
        required: ['next'],
        properties: { next: { $ref: '#/components/schemas/Node', description: 'Next node' } },
      },
      NodeConfig: { $ref: '#/components/schemas/Node', 'x-tags': ['siteConfig'] },
      Constrained: { $ref: '#/components/schemas/Node', required: ['extra'] },
    },
  }));
  assert.equal(model.schemas.length, 2);
  const ref = node(model, '#/components/schemas/Node/properties/next');
  assert.equal(ref.reference.schema, '#/components/schemas/Node');
  assert.equal(ref.reference.url, '/docs/api/schemas/node-config');
  assert.equal(ref.metadata.description, 'Next node');
  assert.deepEqual(node(model, '#/components/schemas/Constrained').metadata.required, ['extra']);
  assert.doesNotThrow(() => JSON.stringify(model));
});

test('dictionary patterns, booleans, null unions and escaped pointers retain their meaning', () => {
  const model = normalize(document({}, {
    schemas: {
      'a/b~c': {
        type: ['object', 'null'],
        nullable: true,
        properties: { 'a.b': { default: '', enum: ['', false, 0, null], readOnly: true } },
        additionalProperties: { type: 'string' },
        patternProperties: { '^/[a-z]+$': { type: 'integer' } },
        $defs: { None: false },
      },
      Ref: { $ref: '#/components/schemas/a~1b~0c' },
    },
  }));
  const root = node(model, '#/components/schemas/a~1b~0c');
  assert.equal(root.properties[0].name, 'a.b');
  assert.equal(root.patternProperties[0].name, '^/[a-z]+$');
  assert.equal(node(model, root.additionalProperties).metadata.type, 'string');
  assert.equal(node(model, root.$defs[0].schema).boolean, false);
  assert.deepEqual(root.metadata.type, ['object', 'null']);
  assert.equal(root.metadata.nullable, true);
  assert.equal(node(model, root.properties[0].schema).metadata.default, '');
  assert.equal(model.schemaNames.Ref.url, model.schemaNames['a/b~c'].url);
});

test('alias naming is explicit AEM convention and rejects ambiguous or invalid cases', () => {
  [
    [{ A: { $ref: '#/components/schemas/A' } }, /alias-only cycle/],
    [{
      Base: {},
      A: { $ref: '#/components/schemas/Base', 'x-tags': ['site'] },
      B: { $ref: '#/components/schemas/Base', 'x-tags': ['site'] },
    }, /Ambiguous AEM public aliases/],
    [{ A: { $ref: '#/components/schemas/Missing' } }, /Unresolved reference/],
    [{ CDNConfig: {}, CdnConfig: {} }, /Schema slug collision/],
  ].forEach(([schemas, error]) => assert.throws(() => normalize(document({}, { schemas })), error));
  const model = normalize(document({}, {
    schemas: { Base: {}, Alias: { $ref: '#/components/schemas/Base', description: 'Annotated' } },
  }));
  assert.equal(model.schemas.length, 2);
});

test('reports unsupported and unresolved structures at their actual source locations', () => {
  [
    [{ $ref: './external.json' }, /components\/schemas\/Bad: Expected a bundled/],
    [{ properties: { id: { $ref: '#/components/schemas/Missing' } } },
      /Bad\/properties\/id\/\$ref: Unresolved reference/],
    [{ if: { type: 'string' } }, /Bad\/if: Unsupported schema applicator/],
    [{ items: [{ type: 'string' }] }, /Bad\/items: Tuple items/],
    [{ $ref: '' }, /components\/schemas\/Bad: Expected a bundled/],
    [{ $ref: '#/components/schemas/%ff' }, /Bad: Invalid reference encoding/],
  ].forEach(([schema, error]) => {
    assert.throws(() => normalize(document({}, { schemas: { Bad: schema } })), error);
  });
  assert.throws(() => normalize(document({
    parameters: [{ in: 'path', name: 'org', schema: {} }],
  })), /parameters\/0: Path parameter must be required/);
  assert.throws(() => normalize(document({
    responses: { 200: { content: { 'application/json': { examples: { remote: { externalValue: 'https://example.com' } } } } } },
  })), /examples\/remote: External example content/);
});

test('requiredness belongs to the property occurrence, not a shared schema target', () => {
  const model = normalize(document({}, {
    schemas: {
      Value: { type: 'string', default: 0 },
      First: { required: ['value'], properties: { value: { $ref: '#/components/schemas/Value' } } },
      Second: { properties: { value: { $ref: '#/components/schemas/Value' } } },
    },
  }));
  const first = node(model, '#/components/schemas/First').properties[0];
  const second = node(model, '#/components/schemas/Second').properties[0];
  assert.equal(first.required, true);
  assert.equal(second.required, false);
  assert.equal(
    node(model, first.schema).reference.schema,
    node(model, second.schema).reference.schema,
  );
  const shared = node(model, '#/components/schemas/Value');
  assert.equal(Object.hasOwn(shared.metadata, 'required'), false);
});

test('unhandled Reference Object and Path Item semantics fail instead of guessing', () => {
  const input = document({
    parameters: [{ $ref: '#/components/parameters/Param', required: true }],
  }, {
    parameters: { Param: { in: 'query', name: 'q', schema: {} } },
  });
  assert.throws(() => normalize(input), /parameters\/0: Unsupported Reference Object siblings/);
  input.paths['/source'] = { $ref: '#/components/pathItems/Source' };
  assert.throws(() => normalize(input), /paths\/~1source: Bundle Path Item references/);
  const older = document();
  older.openapi = '3.0.3';
  assert.throws(() => normalize(older), /openapi: Expected OpenAPI 3.1/);
});

test('names that start anchor contexts must be nonempty', () => {
  [
    [document({ parameters: [{ in: 'query', name: '', schema: {} }] }), /parameters\/0: Expected parameter name/],
    [document({ responses: { 200: { headers: { '': { schema: {} } } } } }), /headers\/: Expected parameter name/],
    [document({ requestBody: { content: { '': {} } } }), /content\/: Expected a nonempty name/],
    [document({}, { schemas: { '': {} } }), /schemas\/: Expected a nonempty name/],
  ].forEach(([input, error]) => assert.throws(() => normalize(input), error));
});

test('derives tag and tag group heading anchors from their names', () => {
  const input = document({ tags: ['source', 'siteConfig'] });
  input['x-tagGroups'] = [{ name: 'Authoring and Publishing', tags: ['source'] }];
  const model = normalize(input);
  assert.deepEqual(model.tags.map(({ name, anchor }) => [name, anchor]), [
    ['source', 'source'], ['siteConfig', 'site-config'],
  ]);
  assert.equal(model.tagGroups[0].anchor, 'authoring-and-publishing');
  assert.throws(() => normalize({ ...input, tags: [{ name: ' ' }] }), /#\/tags\/0\/name/);
  assert.throws(
    () => normalize({ ...input, 'x-tagGroups': [{ name: '---', tags: [] }] }),
    /#\/x-tagGroups\/0\/name/,
  );
  assert.throws(() => normalize(document({ tags: ['source', ''] })), /post\/tags\/1/);
});

test('validates operation identities irrespective of tags and detects media slug collisions', () => {
  const input = document({ tags: [] });
  assert.equal(normalize(input).operations.length, 1);
  ['', ' ', ' status', '---', 'schemas'].forEach((operationId) => {
    assert.throws(() => normalize(document({ operationId })));
  });
  input.paths['/other'] = { get: { operationId: 'makeThing' } };
  assert.throws(() => normalize(input), /Duplicate operationId/);
  input.paths['/other'].get.operationId = 'make-thing';
  assert.throws(() => normalize(input), /Operation slug collision/);
  assert.throws(() => normalize(document({
    requestBody: { content: { 'application/json': {}, 'application-json': {} } },
  })), /Media slug collision/);
});

test('normalizes both complete frozen AEM bundles without changing them', async () => {
  await Promise.all(bundles.map(async ({ version }) => {
    const doc = await readBundle(version);
    const before = JSON.stringify(doc);
    const model = normalizeOpenApi(doc, { version });
    assert.equal(JSON.stringify(doc), before);
    assert.doesNotThrow(() => JSON.stringify(model));
    assert.ok(model.diagnostics.every((entry) => entry.code === 'non-oauth-scopes'));
    const sourceFile = doc.paths['/{org}/sites/{site}/source/{path}'];
    if (sourceFile) {
      assert.equal(
        sourceFile.get.responses[200].description,
        sourceOperations.get.responses[200].description,
      );
      assert.equal(
        sourceFile.put.requestBody.description,
        sourceOperations.put.requestBody.description,
      );
    }
    model.operations.forEach((operation) => {
      assert.ok(operation.url.startsWith(`/docs/${version}/`));
      operation.parameters.forEach((param) => {
        if (param.schema) assert.ok(model.nodes[param.schema]);
      });
    });
  }));
});
