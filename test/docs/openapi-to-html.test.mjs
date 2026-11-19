import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderSite } from '../../scripts/docs/openapi-to-html.mjs';
import {
  allMetadata, bodyRows, dom, metadata, outline, readBundle, tables as tableBlocks, textOf,
} from './helpers.mjs';

function document(operation = {}, components = {}) {
  return {
    openapi: '3.1.0',
    info: { title: 'AEM Admin API', version: '1' },
    servers: [{ url: 'https://api.aem.live' }],
    tags: [{ name: 'source' }, { name: 'job' }],
    paths: {
      '/source': {
        post: { operationId: 'makeThing', tags: ['source'], ...operation },
      },
      '/job': { get: { operationId: 'getJob', tags: ['job'] } },
    },
    components,
  };
}

function page(operation, components) {
  return renderSite(document(operation, components), { version: 'api' })['make-thing/index.html'];
}
const parameterTables = (doc) => [...doc.querySelectorAll('.table.fields:not(.block)')];
const headerTable = (doc) => doc.querySelector('.table.headers.fields.block');
const identityList = ([identity]) => metadata(identity.querySelector('.identity > dl'));
const has = (pairs, pair) => pairs.some(([term, value]) => term === pair[0] && value === pair[1]);

test('ports commerce page, grouped navigation, base URL, and boot-shell coverage', () => {
  const spec = document({ responses: { 200: { description: 'Done' } } });
  const files = renderSite(spec, { version: 'api' });
  assert.deepEqual(Object.keys(files), [
    'nav.html', 'index.html', 'make-thing/index.html', 'get-job/index.html', 'schemas/index.html',
  ]);
  assert.match(files['nav.html'], /href="\/docs\/api\/make-thing"/);
  assert.match(files['nav.html'], /class="group">source/);
  const html = files['make-thing/index.html'];
  assert.match(html, /https:\/\/api.aem.live/);
  assert.match(html, /<!DOCTYPE html>/);
  assert.match(html, /name="template" content="api-reference"/);
  assert.match(html, /nonce="aem" src="\/scripts\/aem.js"/);
  assert.match(html, /<div class="navigation"><p><a href="\/widgets\/api-nav.html\?nav=\/docs\/api\/nav.html">API navigation<\/a><\/p><\/div>/);
  assert.doesNotMatch(html, /class="api-nav"/);
  assert.match(html, /class="content no-examples" id="api-main"/);
  assert.doesNotMatch(html, /class="code-rail"/);
  assert.doesNotMatch(html, /nx\.js|content="Commerce"|da-lit/);
  assert.match(html, /src="\/scripts\/scripts.js"/);
  assert.equal(files['nav.html'], renderSite(spec, { version: 'api' })['nav.html']);
});

test('resolves bundled parameters, responses, headers, schemas, and examples', () => {
  const html = page({
    parameters: [{ $ref: '#/components/parameters/path' }],
    responses: { 200: { $ref: '#/components/responses/success' } },
  }, {
    parameters: {
      path: {
        in: 'path', name: 'org', required: true, description: 'Organization', schema: { type: 'string' },
      },
    },
    responses: {
      success: {
        description: 'Resolved response',
        headers: { etag: { $ref: '#/components/headers/tag' } },
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/result' },
            examples: { success: { $ref: '#/components/examples/success' } },
          },
        },
      },
    },
    headers: { tag: { description: 'Entity tag' } },
    schemas: { result: { type: 'object', properties: { id: { type: 'string' } } } },
    examples: { success: { value: { id: '123' } } },
  });
  ['Path parameters', 'Organization', 'Resolved response', 'Entity tag', '<code>id</code>', 'Response: success', '"123"'].forEach((text) => assert.ok(html.includes(text), text));
});

test('shared fields styling belongs only to parameter and response-header blocks', () => {
  const files = renderSite(document({
    parameters: [{ in: 'query', name: 'value', schema: { type: 'string' } }],
    responses: { 200: { headers: { etag: { schema: { type: 'string' } } } } },
  }, { schemas: { Named: { type: 'object' } } }), { version: 'api' });
  const html = Object.values(files).join('\n');
  const generated = tableBlocks(html);
  assert.equal(generated.length, (html.match(/class="table\b/g) ?? []).length, 'Every table is a table block');
  generated.forEach(({ rows, rowHeaders, classes }) => {
    assert.ok(rows.length >= 2, 'A header row and at least one body row');
    rows.forEach((cells) => assert.equal(cells.length, 2, 'Every row has two cells'));
    if (classes.split(' ').includes('fields')) {
      rowHeaders.slice(1).forEach((label, index) => {
        assert.ok(label && rows[index + 1][0].includes(` id="${label}"`), 'Labelled row header');
      });
    }
  });
  assert.deepEqual(
    generated.filter(({ classes }) => classes.split(' ').includes('fields'))
      .map(({ rows }) => rows[0].join(' | ')).sort(),
    ['Header | Description', 'Parameter | Description'],
  );
  assert.match(files['schemas/index.html'], /class="table schema-index"/);
});

test('parameter tables keep names and metadata before prose in two real cells', () => {
  const html = page({
    parameters: [
      {
        in: 'path',
        name: 'org',
        required: true,
        description: 'Organization',
        schema: { type: 'string', minLength: 1 },
      },
      {
        in: 'query',
        name: 'enabled',
        deprecated: true,
        description: 'Include disabled entries',
        schema: { type: 'boolean', default: false },
      },
      {
        in: 'query',
        name: 'mode',
        description: 'Mode selection',
        schema: { $ref: '#/components/schemas/Mode' },
      },
    ],
  }, { schemas: { Mode: { type: 'string', enum: ['', 'a  b'], default: '' } } });
  const doc = dom(html);
  const tables = parameterTables(doc);
  assert.equal(tables.length, 2);
  tables.forEach((table) => {
    assert.deepEqual([...table.querySelector('tr').children].map(textOf), ['Parameter', 'Description']);
    bodyRows(table).forEach((cells) => {
      assert.equal(cells.length, 2);
      assert.equal(cells[0].getAttribute('scope'), 'row');
      assert.ok(cells[0].getAttribute('aria-labelledby'));
    });
  });
  const [[org], [enabled, mode]] = tables.map(bodyRows);
  assert.equal(org[0].querySelector('.identity [id]').id, 'path-org');
  assert.deepEqual(identityList(org), [['Type', '`string`'], ['Required', 'yes']]);
  assert.equal(org[0].querySelector('[data-required]').getAttribute('data-required'), 'true');
  assert.deepEqual(outline(org[1]), ['p', 'dl.metadata']);
  assert.equal(textOf(org[1].firstElementChild), 'Organization');
  assert.deepEqual(metadata(org[1].lastElementChild), [['Minimum length', '`1`']]);
  assert.deepEqual(identityList(enabled), [['Type', '`boolean`'], ['Required', 'no']]);
  assert.deepEqual(outline(enabled[1]), ['p', 'dl.metadata']);
  assert.equal(textOf(enabled[1].firstElementChild), 'Include disabled entries');
  assert.deepEqual(metadata(enabled[1].lastElementChild), [['Parameter deprecated', 'yes'], ['Default', '`false`']]);
  assert.ok(enabled[1].querySelector('dt.deprecated + dd.deprecated'));
  assert.equal(textOf(mode[0].querySelector('a[href="/docs/api/schemas/mode"]')), 'Mode');
  const pairs = allMetadata(doc);
  assert.ok(has(pairs, ['Type', '`"" | "a  b"`']), 'the enum is the type, spacing kept');
  assert.ok(has(pairs, ['Default', '`""`']));
  assert.ok(!pairs.some(([term]) => term === 'Allowed values'));
});

test('simple response headers keep compact metadata in the name cell and paragraph descriptions separately', () => {
  const html = page({
    parameters: [{
      in: 'query', name: 'enabled', description: 'Parameter description', schema: { type: 'boolean', format: 'none', default: false },
    }],
    responses: {
      404: {
        description: 'Resource not found.',
        headers: {
          'X-Error': {
            description: 'A short descriptive error message',
            schema: { format: 'none', type: 'string' },
          },
          enabled: {
            required: true,
            description: 'First **paragraph**.\n\nSecond paragraph.',
            schema: {
              type: 'boolean', format: 'none', default: false, description: 'Schema description.',
            },
          },
          escaped: {
            description: '<script>unsafe</script>',
            schema: {
              type: 'string', format: '<raw>', pattern: '^a&b$', minLength: 0,
            },
          },
          emptyFormat: { schema: { type: 'string', format: '' } },
          undescribed: { description: 'No schema declared.' },
        },
      },
    },
  });
  const doc = dom(html);
  const table = headerTable(doc);
  const [error, enabled, escaped, emptyFormat, undescribed] = bodyRows(table);
  assert.equal(error[0].querySelector('.identity a > code').id, 'response-404-header-X-Error');
  assert.deepEqual(identityList(error), [['Type', '`string`'], ['Required', 'no'], ['Format', '`none`']]);
  assert.deepEqual(outline(error[1]), ['p']);
  assert.equal(textOf(error[1]), 'A short descriptive error message');
  assert.deepEqual(identityList(enabled), [['Type', '`boolean`'], ['Required', 'yes'], ['Format', '`none`']]);
  assert.deepEqual(outline(enabled[1]), ['p', 'p', 'p', 'dl.metadata']);
  assert.deepEqual(
    [...enabled[1].querySelectorAll('p')].map((p) => p.innerHTML),
    ['First <strong>paragraph</strong>.', 'Second paragraph.', 'Schema description.'],
  );
  assert.deepEqual(metadata(enabled[1].lastElementChild), [['Default', '`false`']]);
  assert.deepEqual(metadata(escaped[1].querySelector('dl')), [['Pattern', '`^a&b$`'], ['Minimum length', '`0`']]);
  assert.ok(has(identityList(escaped), ['Format', '`<raw>`']));
  assert.ok(has(identityList(emptyFormat), ['Format', '``']));
  assert.deepEqual(identityList(undescribed), [['Required', 'no']]);
  assert.equal(textOf(undescribed[1]), 'No schema declared.');
  bodyRows(table).forEach(([identity, description]) => {
    assert.equal(identity.querySelectorAll('dl.metadata').length, 1);
    const terms = allMetadata(description).map(([term]) => term);
    assert.ok(!terms.some((term) => ['Type', 'Format', 'Required'].includes(term)), terms.join());
  });
  assert.equal(table.querySelectorAll('dl.metadata').length, 7);
  assert.equal(table.querySelector('script'), null);
  // escaping is part of the markup contract
  ['<p>&lt;script&gt;unsafe&lt;/script&gt;</p>', '<code>&lt;raw&gt;</code>', '<code>^a&amp;b$</code>']
    .forEach((markup) => assert.ok(html.includes(markup), markup));
  const [[parameter, description]] = bodyRows(parameterTables(doc)[0]);
  assert.ok(has(identityList([parameter]), ['Format', '`none`']));
  assert.equal(textOf(description.firstElementChild), 'Parameter description');
  assert.doesNotMatch(html, /<p>Type:/);
});

test('complex response headers retain schema disclosures, metadata and anchors', () => {
  const html = page({
    responses: {
      200: {
        headers: {
          config: {
            description: 'Header **description**.',
            schema: { $ref: '#/components/schemas/Config' },
          },
        },
      },
    },
  }, {
    schemas: {
      Config: { type: 'object', properties: { enabled: { type: 'boolean', default: false } } },
    },
  });
  const table = html.match(/<div class="table headers fields block" data-block-name="table">([\s\S]*?)<\/table>/)[1];
  assert.match(table, /id="response-200-header-config"/);
  assert.match(table, /<td><p>Header <strong>description<\/strong>\.<\/p>\s*<details class="children"><summary>Schema and constraints<\/summary>(?!<h[1-6])/);
  assert.match(table, /href="\/docs\/api\/schemas\/config">Config<\/a>/);
  assert.match(table, /<dl class="metadata"><div><dt>Type<\/dt><dd><code><a href="\/docs\/api\/schemas\/config">Config<\/a><\/code><\/dd><\/div>/);
  assert.doesNotMatch(table, /<p>Type:/);
});

test('parameter and response-header identities share metadata without changing complex schemas', () => {
  const description = 'First **paragraph**.\n\nSecond explanatory paragraph.';
  const schema = {
    type: 'object',
    format: 'none',
    required: ['id'],
    properties: { id: { type: 'string', minLength: 1 } },
  };
  const doc = dom(page({
    parameters: [{
      in: 'query', name: 'config', description, schema,
    }],
    responses: {
      200: { headers: { config: { description, schema } } },
    },
  }));
  const rows = [parameterTables(doc)[0], headerTable(doc)].map((table) => bodyRows(table)[0]);
  assert.equal(rows[0][0].querySelector('.identity > dl').outerHTML, rows[1][0].querySelector('.identity > dl').outerHTML);
  rows.forEach(([identity, content]) => {
    assert.deepEqual(identityList([identity]), [['Type', '`object`'], ['Required', 'no'], ['Format', '`none`']]);
    assert.equal(identity.querySelector('details'), null);
    assert.deepEqual(outline(content), ['p', 'p', 'dl.metadata', 'details.children']);
    assert.deepEqual(
      [...content.querySelectorAll(':scope > p')].map((p) => p.innerHTML),
      ['First <strong>paragraph</strong>.', 'Second explanatory paragraph.'],
    );
    assert.deepEqual(metadata(content.querySelector(':scope > dl')), [['Required properties in this object', '`"id"`']]);
    const disclosure = content.querySelector(':scope > details');
    assert.equal(textOf(disclosure.querySelector('summary')), 'Schema and constraints');
    assert.doesNotMatch(disclosure.querySelector('summary').nextElementSibling.tagName, /^H[1-6]$/);
    assert.deepEqual(
      metadata(disclosure.querySelector('dl.metadata')),
      [['Type', '`object`'], ['Format', '`none`'], ['Required properties in this object', '`"id"`']],
    );
    const pairs = allMetadata(disclosure);
    assert.ok(has(pairs, ['Minimum length', '`1`']));
    assert.ok(has(pairs, ['Required in this object', 'yes']));
  });
  [['query-config', rows[0]], ['response-200-header-config', rows[1]]].forEach(([id, [identity, content]]) => {
    assert.equal(identity.querySelector(`a[href="#${id}"] > code`).id, id);
    assert.ok(content.querySelector(`[id="${id}-id"]`), `${id}-id`);
  });
});

test('parameter and header schema examples render once in the description, outside schema disclosures', () => {
  const html = page({
    parameters: [
      {
        in: 'query', name: 'since', description: 'Time span.', schema: { type: 'string', example: '5m' },
      },
      {
        in: 'query',
        name: 'filter',
        description: 'Filter.',
        schema: {
          type: 'object', properties: { id: { type: 'string', examples: ['a'] } }, examples: [{ id: 'a' }],
        },
      },
    ],
    responses: {
      200: { headers: { 'X-Count': { description: 'Count.', schema: { type: 'integer', examples: [1, 2] } } } },
    },
  });
  const doc = dom(html);
  const [since, filter] = bodyRows(parameterTables(doc)[0]);
  const [header] = bodyRows(headerTable(doc));
  [since, filter, header].forEach(([identity]) => {
    assert.equal(identity.querySelector('details'), null);
    assert.ok(!allMetadata(identity).some(([term]) => term.startsWith('Example')));
  });
  assert.deepEqual(outline(since[1]), ['p', 'dl.metadata']);
  assert.deepEqual(metadata(since[1].lastElementChild), [['Example', '`"5m"`']]);
  const examples = (details) => [textOf(details.querySelector('summary')),
    ...[...details.querySelectorAll(':scope > p')].map(textOf)];
  assert.deepEqual(examples(header[1].querySelector('details.examples')), ['Examples (2)', '`1`', '`2`']);
  const [authored, structure] = filter[1].querySelectorAll(':scope > details');
  assert.deepEqual(examples(authored), ['Examples (1)', '`{"id":"a"}`']);
  assert.equal(textOf(structure.querySelector('summary')), 'Schema and constraints');
  assert.doesNotMatch(structure.innerHTML, /\{"id":"a"\}|Examples \(1\)/);
  assert.deepEqual(
    metadata(structure.querySelector('.field dl.metadata')),
    [['Type', '`string`'], ['Required in this object', 'no'], ['Example', '`"a"`']],
  );
  assert.doesNotMatch(html, /Schema examples|authored example/);
});

test('content-only parameters and boolean header schemas retain requiredness, representations and types', () => {
  const html = page({
    parameters: [{
      in: 'query',
      name: 'value',
      required: true,
      description: 'Representation.',
      content: { 'text/plain': { schema: { type: 'string' }, example: 'text' } },
    }],
    responses: {
      200: {
        headers: {
          any: { schema: true },
          never: { schema: false },
        },
      },
    },
  });
  assert.match(html, /id="query-value">value<\/code><\/a><dl class="metadata"><div data-required="true"><dt>Required<\/dt><dd>yes/);
  assert.match(html, /<\/th><td><p>Representation\.<\/p>[\s\S]*id="query-value-text-plain"/);
  assert.match(html, /<dt>Type<\/dt><dd><code>any value<\/code>/);
  assert.match(html, /<dt>Type<\/dt><dd><code>no values<\/code>/);
});

test('both frozen bundles retain X-Error values and anchors in compact response metadata', async () => {
  await Promise.all([
    ['admin', 'preview-status'],
    ['api', 'get-source-document'],
  ].map(async ([version, route]) => {
    const input = await readBundle(version);
    const doc = dom(renderSite(input, { version })[`${route}/index.html`]);
    const name = doc.getElementById('response-404-header-X-Error');
    assert.equal(name.parentElement.getAttribute('href'), '#response-404-header-X-Error');
    const [identity, description] = name.closest('tr').children;
    assert.deepEqual(identityList([identity]), [['Type', '`string`'], ['Required', 'no'], ['Format', '`none`']]);
    assert.equal(textOf(description.firstElementChild), 'A short descriptive error message');
  }));
});

test('response sections keep source descriptions as prose after status-only headings', () => {
  const description = 'The document is returned as-is. Its format is indicated by `Content-Type`.'
    + '\n\nNo response title is inferred. Values such as <raw> remain escaped.';
  const html = page({
    responses: {
      200: {
        description,
        headers: { etag: { description: 'Entity tag', schema: { type: 'string' } } },
        content: {
          'application/json': {
            schema: { type: 'object', properties: { id: { type: 'string' } } },
            example: { id: '123' },
          },
        },
      },
      302: { description: 'Follow the redirect.' },
      400: { description: '' },
      500: { description: 'The operation failed. Retry later.' },
      default: {},
    },
  });
  assert.equal((html.match(/<section class="response">/g) ?? []).length, 5);
  [
    ['200', '2xx'], ['302', '3xx'], ['400', '4xx'], ['500', '5xx'], ['default', 'dxx'],
  ].forEach(([status, family]) => {
    assert.ok(html.includes('<section class="response">\n'
      + `      <h3 class="heading" id="response-${status}"${status === '200' ? '' : ` data-examples="response-${status}"`}>`
      + `<span class="status-badge status-${family}">${status}</span></h3>`));
  });
  assert.match(html, /<\/h3>\s*<div class="description"><p>The document is returned as-is\. Its format is indicated by <code>Content-Type<\/code>\.<\/p>\s*<p>No response title is inferred\. Values such as &lt;raw&gt; remain escaped\.<\/p><\/div>/);
  assert.match(html, /<div class="table headers fields block" data-block-name="table">\s*<table>/);
  assert.match(html, /id="response-200-header-etag"/);
  assert.match(html, /id="response-200-body-application-json"/);
  assert.match(html, /id="response-200-body-application-json-id"/);
  assert.match(html, /href="#response-200-body-application-json-examples"/);
  assert.match(html, /id="response-200-body-application-json-examples"/);
  assert.match(html, /id="response-400" data-examples="response-400">[\s\S]*?<\/h3>\s*<\/section>/);
  assert.match(html, /id="response-default" data-examples="response-default">[\s\S]*?<\/h3>\s*<\/section>/);
  [...html.matchAll(/<h3 class="heading"[^>]*>([\s\S]*?)<\/h3>/g)]
    .forEach(([, heading]) => assert.doesNotMatch(heading, /description|<p>/));
});

test('preserves observed top-level allOf fields and contribution-specific requiredness', () => {
  const html = page({ responses: { 200: { content: { 'application/json': { schema: { allOf: [{ $ref: '#/components/schemas/base' }, { type: 'object', properties: { live: { type: 'object' } } }] } } } } } }, {
    schemas: { base: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
  });
  assert.match(html, /href="\/docs\/api\/schemas\/base">base/);
  assert.match(html, /<code>live<\/code>/);
});

test('shows each observed oneOf request alternative without merging its requirements', () => {
  const html = page({ requestBody: { content: { 'application/json': { schema: { oneOf: [{ $ref: '#/components/schemas/hashed' }, { $ref: '#/components/schemas/key' }] } } } } }, {
    schemas: {
      hashed: { required: ['hash'], properties: { hash: { type: 'string' } } },
      key: { required: ['key'], properties: { key: { type: 'string' } } },
    },
  });
  assert.match(html, /<p>Option 1<\/p>\s*<dl class="metadata"><div><dt>Type<\/dt><dd><code><a href="\/docs\/api\/schemas\/hashed">hashed<\/a><\/code>/);
  assert.match(html, /<p>Option 2<\/p>\s*<dl class="metadata"><div><dt>Type<\/dt><dd><code><a href="\/docs\/api\/schemas\/key">key<\/a><\/code>/);
  assert.doesNotMatch(html, /id="request-body-application-json-hash"/);
  assert.doesNotMatch(html, /id="request-body-application-json-key"/);
});

test('represents arrays in both body directions and their shallow item fields', () => {
  const content = { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/item' } } } };
  const html = page({ requestBody: { content }, responses: { 200: { content } } }, {
    schemas: { item: { type: 'object', properties: { name: { type: 'string' } } } },
  });
  assert.equal((html.match(/<dt>Type<\/dt><dd><code><a href="\/docs\/api\/schemas\/item">item<\/a>\[\]<\/code>/g) ?? []).length, 2);
  assert.equal((html.match(/<code>\[\]<\/code>/g) ?? []).length, 2);
  assert.doesNotMatch(html, /id="request-body-application-json-\[\].name"/);
});

test('preserves named and inline examples, inline-code prose, and JSON indentation', () => {
  const html = page({
    description: 'Uses `source`.\n\nSecond paragraph.',
    requestBody: { content: { 'application/json': { example: { id: 1 } } } },
    responses: { 200: { content: { 'application/json': { examples: { success: { value: { item: { id: 2 } } }, empty: { value: false } } } } } },
  });
  assert.equal((html.match(/class="code-sample"/g) ?? []).length, 3);
  assert.match(html, /Response: success/);
  assert.match(html, /\n {4}"id": 2/);
  assert.match(html, /Uses <code>source<\/code>/);
  assert.match(html, /<p>Second paragraph.<\/p>/);
  assert.doesNotMatch(html, /`source`/);
});

test('ties every rail example to the content section boundary it illustrates', () => {
  const html = page({
    requestBody: { content: { 'application/json': { examples: { a: { value: 1, description: 'First.' }, b: { value: 2 } } } } },
    responses: {
      200: { description: 'Done', content: { 'application/json': { example: { ok: true } } } },
      400: { description: 'Bad' },
      404: { description: 'Missing', content: { 'application/json': { example: { error: 'x' } } } },
    },
  });
  const [content, rail] = html.split('<div class="code-rail"');
  const boundaries = [...content.matchAll(/<(h[23])[^>]* data-examples="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)]
    .map(([, tag, key, text]) => `${tag}:${key}:${text.replace(/<[^>]+>/g, '')}`);
  // the first status's section starts at the Response heading; later statuses at their own
  assert.deepEqual(boundaries, [
    'h2:request-body:Request body', 'h2:response-200:Response', 'h3:response-400:400', 'h3:response-404:404',
  ]);
  assert.doesNotMatch(content, /<h3 class="heading" id="response-200" data-examples/);
  const items = [...rail.matchAll(/<div (?:class="code-sample" )?data-examples="([^"]+)">/g)].map(([, key]) => key);
  assert.deepEqual(items, ['request-body', 'request-body', 'request-body', 'response-200', 'response-404']);
  // a description is an unclassed div, so it stays content rather than becoming a block
  assert.match(rail, /<div data-examples="request-body"><p>First\.<\/p><\/div><div class="code-sample" data-examples="request-body">/);
});

test('emits no example boundaries in the rail when an operation has no examples', () => {
  const html = page({ responses: { 200: { description: 'Done' } } });
  assert.doesNotMatch(html, /class="code-rail"/);
  assert.match(html, /<h2 data-examples="response-200">Response<\/h2>/);
});

test('gives request and response example headers the method badge, linked name, and media type', () => {
  const html = page({
    requestBody: { content: { 'application/json': { example: { id: 1 } } } },
    responses: { 202: { content: { 'application/json': { example: { job: 'a' } } } } },
  });
  const heads = [...html.matchAll(/<div class="head">(.*?)<\/div>/g)].map(([, head]) => head);
  assert.equal(heads.length, 2);
  heads.forEach((head) => {
    assert.match(head, /^<span class="title"><span class="http-method http-post">POST<\/span> <a href="#[^"]+"><span class="name">/);
    assert.match(head, /<\/a>.* <span class="media">\(application\/json\)<\/span><\/span>$/);
  });
  assert.doesNotMatch(heads[0], /code-status/);
  assert.match(heads[1], /<\/a> <span class="code-status status-2xx">202<\/span> <span class="media">/);
});

test('renders declared non-JSON media types and request-body descriptions', () => {
  const html = page({
    requestBody: { description: 'Omit the body when copying.', content: { '*/*': { schema: { type: 'string', format: 'binary' } } } },
    responses: { 200: { content: { 'text/yaml': { schema: { type: 'object', properties: { version: { type: 'string' } } } }, 'text/plain': { schema: { type: 'string' } } } } },
  });
  ['Omit the body when copying.', '<code>*/*</code>', '<code>binary</code>', '<code>text/yaml</code>', '<code>text/plain</code>', '<code>version</code>'].forEach((text) => assert.ok(html.includes(text), text));
});

test('shows security alternatives, declared schemes, and scopes', () => {
  const html = page({ security: [{ AuthCookie: ['preview:write'] }, { BearerToken: [] }, {}] }, {
    securitySchemes: {
      AuthCookie: { type: 'apiKey', in: 'cookie', name: 'auth_token' },
      BearerToken: { type: 'http', scheme: 'bearer' },
    },
  });
  ['Authentication', 'One of the following', 'auth_token', 'preview:write', 'bearer', 'No authentication required'].forEach((text) => assert.ok(html.includes(text), text));
});

test('authentication presentation preserves AND, OR, anonymous access and scope terminology', () => {
  const html = page({
    security: [
      { AuthCookie: ['preview:write'], BearerToken: [] },
      { OAuth: ['read:data'] },
      {},
    ],
  }, {
    securitySchemes: {
      AuthCookie: { type: 'apiKey', in: 'cookie', name: 'auth_token' },
      BearerToken: { type: 'http', scheme: 'bearer' },
      OAuth: {
        type: 'oauth2',
        flows: {
          clientCredentials: {
            tokenUrl: 'https://auth.example/token',
            scopes: { 'read:data': 'Read data' },
          },
        },
      },
    },
  });
  const list = html.match(/<ul class="alternatives">([\s\S]*?)<\/ul>/)[1];
  const alternatives = [...list.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((match) => match[1]);
  assert.equal(alternatives.length, 3);
  assert.match(html, /One of the following:/);
  assert.match(alternatives[0], /class="name">AuthCookie/);
  assert.match(alternatives[0], /<dt>Location<\/dt><dd>cookie<\/dd>/);
  assert.match(alternatives[0], /<dt>Credential name<\/dt><dd><code>auth_token<\/code>/);
  assert.match(alternatives[0], /<dt>permissions<\/dt><dd><code>preview:write/);
  assert.match(alternatives[0], /class="and">AND<\/span>[\s\S]*class="name">BearerToken/);
  assert.match(alternatives[0], /<dt>Scheme<\/dt><dd>bearer<\/dd>/);
  assert.doesNotMatch(alternatives[0], /<dt>scopes/);
  assert.match(alternatives[1], /<dt>scopes<\/dt><dd><code>read:data/);
  assert.doesNotMatch(alternatives[1], /\(\)/);
  assert.equal(alternatives[2], 'No authentication required');
  assert.match(page({ security: [] }), /class="alternatives"><li>No authentication required<\/li>/);
});

test('long endpoints retain every character with optional breaks at path and query delimiters', () => {
  const spec = document();
  const endpoint = '/snapshot/{org}/{site}/main/{snapshotId}?review=[request,approve,reject]';
  spec.paths = {
    [endpoint]: { post: { operationId: 'longPath', responses: { 200: { description: 'Done' } } } },
  };
  const html = renderSite(spec, { version: 'admin' })['long-path/index.html'];
  const markup = html.match(/<code class="http-path">([\s\S]*?)<\/code>/)[1];
  assert.match(markup, /\/<wbr>snapshot\/<wbr>/);
  assert.match(markup, /\?<wbr>review=/);
  assert.equal(markup.replaceAll('<wbr>', ''), endpoint);
});

test('endpoints carry the complete copyable URL from their own server, with the path verbatim', async () => {
  const endpointTag = (html) => html.match(/<p class="endpoint"[^>]*>/)[0];
  await Promise.all([
    ['admin', 'preview-status', 'https://admin.hlx.page/preview/{org}/{site}/{ref}/{path}'],
    ['api', 'get-config-org-sub', 'https://api.aem.live/{org}/config/{path}'],
  ].map(async ([version, route, url]) => {
    const input = await readBundle(version);
    const html = renderSite(input, { version })[`${route}/index.html`];
    assert.equal(endpointTag(html), `<p class="endpoint" data-url="${url}">`);
  }));

  const spec = document();
  spec.servers = [{ url: 'https://example.com/base/' }];
  spec.paths['/snapshot/{id}?review=[a,b]&x="y"'] = { get: { operationId: 'pathQuery' } };
  spec.paths['/job'].get.servers = [{ url: 'https://jobs.example.com' }, { url: 'https://alt.example.com' }];
  let files = renderSite(spec, { version: 'api' });
  assert.equal(
    endpointTag(files['path-query/index.html']),
    '<p class="endpoint" data-url="https://example.com/base/snapshot/{id}?review=[a,b]&amp;x=&quot;y&quot;">',
  );
  assert.equal(endpointTag(files['get-job/index.html']), '<p class="endpoint" data-url="https://jobs.example.com/job">');

  delete spec.servers;
  delete spec.paths['/job'].get.servers;
  files = renderSite(spec, { version: 'api' });
  assert.equal(endpointTag(files['get-job/index.html']), '<p class="endpoint">');
});

test('renders the observed YAML examples as YAML rather than JSON strings', () => {
  const html = page({
    responses: {
      200: {
        content: {
          'text/yaml': {
            examples: { success: { value: 'version: 1\nindices:\n  default: {}\n' } },
          },
        },
      },
    },
  });
  assert.match(html, /<code class="language-yaml">version: 1\nindices:\n {2}default: \{\}/);
  assert.match(html, /Response: success/);
});

test('converts only safe breaks and known internal tag links, preserving escaping', () => {
  const files = renderSite(document({ description: 'First<br>Second<br/>Third [job](#tag/job) <script>alert(1)</script> [bad](javascript:alert) <br onclick="bad()">' }), { version: 'admin' });
  const html = files['make-thing/index.html'];
  assert.match(html, /First<br>Second<br>Third/);
  assert.match(html, /href="\/docs\/admin\/get-job">job<\/a>/);
  assert.ok(files['get-job/index.html']);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /&lt;br onclick=/);
});

test('renders external Markdown links, bare URLs and autolinks without changing destinations', () => {
  const html = page({
    description: '[Example](https://example.com/a_(b)?x=1&y=2) '
      + 'http://example.com/a_b_c. <https://example.com/*literal*/__path__> '
      + '(https://example.com/path).',
  });
  assert.match(html, /<a href="https:\/\/example\.com\/a_\(b\)\?x=1&amp;y=2">Example<\/a>/);
  assert.match(html, /<a href="http:\/\/example\.com\/a_b_c">http:\/\/example\.com\/a_b_c<\/a>\./);
  assert.match(html, /<a href="https:\/\/example\.com\/\*literal\*\/__path__">https:\/\/example\.com\/\*literal\*\/__path__<\/a>/);
  assert.match(html, /\(<a href="https:\/\/example\.com\/path">https:\/\/example\.com\/path<\/a>\)\./);
});

test('retains resolved schema and tag links with formatted labels and literal unresolved links', () => {
  const html = page({
    description: '[**Job**](#tag/job) [`Detail`](#schema/Detail) '
      + '[missing](#schema/Missing) & already &amp; escaped <br>',
  }, { schemas: { Detail: { type: 'string' } } });
  assert.match(html, /<a href="\/docs\/api\/get-job"><strong>Job<\/strong><\/a>/);
  assert.match(html, /<a href="\/docs\/api\/schemas\/detail"><code>Detail<\/code><\/a>/);
  assert.match(html, /\[missing\]\(#schema\/Missing\) &amp; already &amp;amp; escaped <br>/);
});

test('renders both emphasis delimiters while protecting code and URL contents', () => {
  const html = page({
    description: '*italic* _italic_ **bold** __bold__ '
      + '**bold with _italic_ and `*literal*`** '
      + '**before `**literal**` after** '
      + '[**linked** `code`](https://example.com/a_*b*_c) '
      + '`https://example.com/_code_ **literal** <raw>` '
      + 'https://example.com/__path__/*literal* identifier_with_underscores',
  });
  assert.match(html, /<em>italic<\/em> <em>italic<\/em> <strong>bold<\/strong> <strong>bold<\/strong>/);
  assert.match(html, /<strong>bold with <em>italic<\/em> and <code>\*literal\*<\/code><\/strong>/);
  assert.match(html, /<strong>before <code>\*\*literal\*\*<\/code> after<\/strong>/);
  assert.match(html, /<a href="https:\/\/example\.com\/a_\*b\*_c"><strong>linked<\/strong> <code>code<\/code><\/a>/);
  assert.match(html, /<code>https:\/\/example\.com\/_code_ \*\*literal\*\* &lt;raw&gt;<\/code>/);
  assert.match(html, /<a href="https:\/\/example\.com\/__path__\/\*literal\*">https:\/\/example\.com\/__path__\/\*literal\*<\/a> identifier_with_underscores/);
});

test('preserves paragraphs, soft breaks and explicit Markdown hard breaks', () => {
  const html = page({
    description: 'First  \nSecond\\\nThird\n  soft continuation.'
      + '\n\nAnother paragraph.<br/>Last line.',
  });
  assert.match(html, /<p>First<br>Second<br>Third soft continuation\.<\/p>\s*<p>Another paragraph\.<br>Last line\.<\/p>/);
  const crlf = page({ description: 'First  \r\nSecond\\\r\nThird' });
  assert.match(crlf, /<p>First<br>Second<br>Third<\/p>/);
});

test('escapes HTML and link labels and leaves unsafe or invalid destinations unlinked', () => {
  const html = page({
    description: '[<img src=x onerror=alert(1)>](https://example.com/?a=1&b=2) '
      + '[bad](javascript:alert(1)) [data](data:text/html,unsafe) '
      + '[relative](//example.com) [invalid](https://) '
      + '<javascript:alert(1)> <script>alert(1)</script> '
      + '[attribute](https://example.com/"onclick="alert) '
      + 'https://example.com/\\evil [control](https://example.com/\0evil) '
      + '[encoded](javascript&#58;alert) <https://> '
      + '[nested <https://example.com>](https://example.com/outer)',
  });
  assert.match(html, /<a href="https:\/\/example\.com\/\?a=1&amp;b=2">&lt;img src=x onerror=alert\(1\)&gt;<\/a>/);
  const content = html.slice(html.indexOf('<main'));
  assert.doesNotMatch(content, /<img|<script|href="(?:javascript:|data:|\/\/)|href="https:\/\/"|<a\b[^>]*onclick=/);
  assert.match(html, /\[bad\]\(javascript:alert\(1\)\)/);
  assert.match(html, /\[attribute\]\(https:\/\/example\.com\/"onclick="alert\)/);
  assert.doesNotMatch(html, /<a href="https:\/\/example\.com\/\\evil"/);
  assert.doesNotMatch(html, /<a href="[^"]*\0/);
  assert.match(html, /<a href="https:\/\/example\.com\/outer">nested &lt;https:\/\/example\.com&gt;<\/a>/);
});

test('uses shared formatting for operation, request, response, parameter, header and schema descriptions', () => {
  const description = '**Details**: [guide](https://example.com/guide)  \n_next line_';
  const input = document({
    description,
    parameters: [{
      in: 'query', name: 'filter', description, schema: { type: 'string' },
    }],
    requestBody: { description, content: { 'application/json': { schema: { type: 'string' } } } },
    responses: {
      200: {
        description,
        headers: { etag: { description, schema: { type: 'string' } } },
        content: { 'application/json': { schema: { type: 'string', description } } },
      },
    },
  }, { schemas: { Detail: { type: 'string', description } } });
  const files = renderSite(input, { version: 'api' });
  const formatted = '<strong>Details</strong>: <a href="https://example.com/guide">guide</a><br><em>next line</em>';
  assert.equal(files['make-thing/index.html'].split(formatted).length - 1, 6);
  assert.ok(files['schemas/detail/index.html'].includes(formatted));
  assert.ok(files['schemas/index.html'].includes(formatted));
});

test('keeps the frozen Admin API preview-status 429 description in one paragraph with a clickable URL', async () => {
  const input = await readBundle('admin');
  const before = structuredClone(input);
  const html = renderSite(input, { version: 'admin' })['preview-status/index.html'];
  assert.match(html, /id="response-429" data-examples="response-429"><span class="status-badge status-4xx">429<\/span><\/h3>\s*<div class="description"><p>Rate limited by admin service\. see <a href="https:\/\/www\.aem\.live\/docs\/limits#admin-api-limits">https:\/\/www\.aem\.live\/docs\/limits#admin-api-limits<\/a><\/p><\/div>/);
  assert.deepEqual(input, before);
});

test('renders authored HTML code and links like their Markdown forms', () => {
  const html = page({
    description: '<code>{org}/x*y*</code> <CODE>upper</CODE> '
      + '<a href="#tag/job/operation/getJob">**Job**</a> '
      + '<A HREF="https://example.com/guide">guide</A>',
  });
  assert.match(html, /<code>\{org\}\/x\*y\*<\/code> <code>upper<\/code>/);
  assert.match(html, /<a href="\/docs\/api\/get-job"><strong>Job<\/strong><\/a>/);
  assert.match(html, /<a href="https:\/\/example\.com\/guide">guide<\/a>/);
});

test('keeps unsupported authored HTML escaped', () => {
  const html = page({
    description: '<a href="javascript:alert(1)">script</a> '
      + '<a href="#tag/missing/operation/nope">missing</a> '
      + '<a href=\'https://example.com/single\'>single</a> '
      + '<a href="https://example.com/extra" onclick="bad()">extra</a> '
      + '<a href="https://example.com/?a&amp;b">entity</a> '
      + '<code><b>nested</b></code> <code></code> <a href="https://example.com/empty"></a>',
  });
  const content = html.slice(html.indexOf('<main'));
  assert.match(content, /&lt;a href="javascript:alert\(1\)"&gt;script&lt;\/a&gt;/);
  assert.match(content, /&lt;a href="#tag\/missing\/operation\/nope"&gt;missing&lt;\/a&gt;/);
  assert.match(content, /&lt;code&gt;&lt;b&gt;nested&lt;\/b&gt;&lt;\/code&gt; &lt;code&gt;&lt;\/code&gt;/);
  assert.doesNotMatch(content, /<a href="(?:javascript:|#)|<a[^>]*onclick|<b>|<code><\/code>|<a [^>]*><\/a>/);
  // a bare URL inside unsupported markup is still autolinked, within the escaped text
  assert.match(content, /&lt;a href='<a href="https:\/\/example\.com\/single">https:\/\/example\.com\/single<\/a>'&gt;single&lt;\/a&gt;/);
  assert.match(content, /&lt;a href="<a href="https:\/\/example\.com\/extra">https:\/\/example\.com\/extra<\/a>" onclick="bad\(\)"&gt;extra&lt;\/a&gt;/);
});

test('never nests links when Markdown and authored HTML links contain each other', () => {
  const html = page({
    description: '[<a href="https://example.com/inner">inner</a>](https://example.com/outer) '
      + '<a href="https://example.com/outer2">[inner2](https://example.com/inner2)</a>',
  });
  const content = html.slice(html.indexOf('<main'));
  assert.match(content, /<a href="https:\/\/example\.com\/outer">&lt;a href="https:\/\/example\.com\/inner"&gt;inner&lt;\/a&gt;<\/a>/);
  assert.match(content, /<a href="https:\/\/example\.com\/outer2">\[inner2\]\(https:\/\/example\.com\/inner2\)<\/a>/);
  assert.doesNotMatch(content, /<a href="https:\/\/example\.com\/inner2?"/);
});

test('renders the frozen Admin API and API Service tag descriptions without escaped markup', async () => {
  const roots = {};
  await Promise.all(['admin', 'api'].map(async (version) => {
    const input = await readBundle(version);
    const before = structuredClone(input);
    const files = renderSite(input, { version });
    assert.deepEqual(input, before);
    roots[version] = files['index.html'];
    Object.entries(files).forEach(([name, html]) => {
      const content = html.slice(html.indexOf('<main')).replace(/<pre[\s\S]*?<\/pre>/g, '');
      assert.doesNotMatch(content, /&lt;a |&lt;code&gt;|&lt;br/, `${version} ${name}`);
      assert.doesNotMatch(content, /<a [^>]*>(?:(?!<\/a>)[\s\S])*<a /, `${version} ${name}`);
    });
  }));
  const { admin, api } = roots;
  assert.match(admin, /use the <a href="\/docs\/admin\/create-site-api-key">Create Site API key<\/a> API/);
  assert.match(admin, /See our <a href="https:\/\/www\.aem\.live\/docs\/admin-apikeys">documentation<\/a> for details/);
  assert.equal(admin.split('href="https://www.aem.live/docs/admin-apikeys"').length, 2);
  assert.match(admin, /<code>\/config\/\{org\}\/sites\/\{site\}\/cdn\/prod\.json<\/code> endpoint/);
  assert.match(admin, /<code>\/config\/\{org\}\/profiles\/default-profile\/cdn\/prod\.json<\/code> endpoint/);
  assert.match(api, /use the <a href="\/docs\/api\/update-config-site-sub">Site Config Property<\/a> API/);
  assert.match(api, /<code>\/\{org\}\/sites\/\{site\}\/config\/cdn\/prod\.json<\/code> endpoint/);
  assert.match(api, /<code>\/\{org\}\/profiles\/\{profile\}\/config\/cdn\/prod\.json<\/code> endpoint/);
});

test('splits prose paragraphs at runs of two or more breaks outside code spans', () => {
  const paragraphs = (description) => {
    const html = page({ description });
    const content = html.slice(html.indexOf('id="api-main"'), html.indexOf('</main>'));
    return [...content.matchAll(/<p>([\s\S]*?)<\/p>/g)].map(([, text]) => text);
  };
  assert.deepEqual(paragraphs('one<br><br>two'), ['one', 'two']);
  assert.deepEqual(paragraphs('one <br> <BR/>\n<br> two'), ['one', 'two']);
  assert.deepEqual(paragraphs('one<br>two'), ['one<br>two']);
  assert.deepEqual(paragraphs('`one<br><br>two`'), ['<code>one&lt;br&gt;&lt;br&gt;two</code>']);
  assert.deepEqual(paragraphs('`code` one<br><br>`code` two'), ['<code>code</code> one', '<code>code</code> two']);
  assert.deepEqual(paragraphs('<br><br>one<br><br>'), ['one']);
  assert.deepEqual(paragraphs('one\n\ntwo<br><br>three'), ['one', 'two', 'three']);
});

test('splits break runs like blank lines in fields, and keeps them in the schema index', () => {
  const files = renderSite(document({
    parameters: [{
      in: 'query', name: 'filter', description: 'one<br><br>two', schema: { type: 'string' },
    }],
  }, { schemas: { Detail: { type: 'string', description: 'one<br><br>two' } } }), { version: 'api' });
  assert.match(files['make-thing/index.html'], /<p>one<\/p>\s*<p>two<\/p>/);
  assert.match(files['schemas/index.html'], /<td>one<br><br>two<\/td>/);
});

test('renders the frozen Admin API and API Service break runs as paragraphs', async () => {
  const render = async (version) => renderSite(await readBundle(version), { version });
  const [admin, api] = await Promise.all([render('admin'), render('api')]);
  assert.match(admin['index.html'], /all subsequent requests\.<\/p>\s*<p>Alternatively, you can provide/);
  assert.match(api['index.html'], /all subsequent requests\.<\/p>\s*<p>Alternatively, you can provide/);
  assert.match(admin['index.html'], /to create one\.<br>\s*See our <a href="https:\/\/www\.aem\.live\/docs\/admin-apikeys">/);
  assert.match(
    admin['bulk-status/index.html'],
    /recursively processed\.<\/p>\s*<p>The response will contain[^<]*(?:<code>[^<]*<\/code>[^<]*)*<\/p>\s*<p>Note that the bulk status/,
  );
  // single breaks in the API Service folder deletion stay line breaks within one paragraph
  assert.match(
    api['delete-source-folder/index.html'],
    /<p>Deletes a folder[^<]*(?:<code>[^<]*<\/code>[^<]*)*<br>\s*Before they are moved[^<]*<br>\s*If the folder is already/,
  );
});

test('derives meta descriptions from the formatted description as plain text', async () => {
  const meta = (html) => html.match(/<meta name="description" content="([^"]*)">/)[1];
  const html = page({
    description: '[guide](https://example.com/guide) and <a href="#tag/job/operation/getJob">Job</a> '
      + '**bold** _em_ `code` <code>html</code><br>next\nline a < b & "q" \'s <script>x</script>',
  });
  assert.equal(
    meta(html),
    'guide and Job bold em code html next line a &lt; b &amp; &quot;q&quot; &#39;s &lt;script&gt;x&lt;/script&gt;',
  );
  const api = renderSite(await readBundle('api'), { version: 'api' });
  assert.match(
    meta(api['delete-source-folder/index.html']),
    /moved to the \.trash folder\. Before they are moved, a new version of all the files is created\. If the folder/,
  );
  Object.entries(api).forEach(([name, file]) => {
    if (name !== 'nav.html') assert.doesNotMatch(meta(file), /&lt;br|&lt;a |&lt;code|\]\(|\*\*/, name);
  });
});

test('constraints and a single inline example share one metadata list in each description', () => {
  const html = page({
    parameters: [
      {
        in: 'query',
        name: 'filter',
        deprecated: true,
        description: 'Filter.',
        schema: { type: 'string', default: 'all', example: 'modified' },
      },
      {
        in: 'query', name: 'limit', description: 'Limit.', schema: { type: 'integer', default: 10, examples: [5, 50] },
      },
    ],
    responses: {
      200: {
        headers: { 'X-Count': { description: 'Count.', schema: { type: 'integer', minimum: 0, example: 3 } } },
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                status: {
                  type: 'integer', description: 'Status.', default: 200, example: 201,
                },
              },
            },
          },
        },
      },
    },
  });
  const doc = dom(html);
  const [filter, limit] = bodyRows(parameterTables(doc)[0]);
  const [header] = bodyRows(headerTable(doc));
  const [status] = bodyRows(doc.querySelector('.table.fields.block:not(.headers)'));
  [filter, limit, header, status].forEach(([, content]) => {
    assert.equal(content.querySelectorAll('dl').length, 1);
  });
  assert.deepEqual(outline(filter[1]), ['p', 'dl.metadata']);
  assert.equal(textOf(filter[1].firstElementChild), 'Filter.');
  assert.deepEqual(
    metadata(filter[1].lastElementChild),
    [['Parameter deprecated', 'yes'], ['Default', '`"all"`'], ['Example', '`"modified"`']],
  );
  assert.deepEqual(outline(limit[1]), ['p', 'dl.metadata', 'details.children.examples']);
  assert.deepEqual(metadata(limit[1].querySelector('dl')), [['Default', '`10`']]);
  assert.equal(textOf(limit[1].querySelector('summary')), 'Examples (2)');
  assert.deepEqual(metadata(header[1].querySelector('dl')), [['Minimum', '`0`'], ['Example', '`3`']]);
  assert.deepEqual(outline(status[1]), ['p', 'dl.metadata']);
  assert.equal(textOf(status[1].firstElementChild), 'Status.');
  assert.deepEqual(metadata(status[1].lastElementChild), [['Default', '`200`'], ['Example', '`201`']]);
});

test('a representation shares one metadata list with its root schema; structure stays separate', () => {
  const html = renderSite({
    openapi: '3.1.0',
    info: { title: 'Representations', version: '1' },
    paths: {
      '/things': {
        post: {
          operationId: 'makeThing',
          parameters: [{
            in: 'query',
            name: 'q',
            content: { 'text/plain': { schema: { type: 'string', minLength: 1 }, example: 'abc' } },
          }],
          requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { a: { type: 'string' } } } } } },
          responses: {
            200: { description: 'Text.', content: { 'text/plain': { schema: { type: 'string' } } } },
            201: {
              description: 'Object.',
              content: {
                'application/json': {
                  schema: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
                  example: { id: 'x' },
                },
              },
            },
            202: { description: 'Array.', content: { 'application/json': { schema: { type: 'array', items: { type: 'string', enum: ['a', 'b'] } } } } },
            203: { description: 'Reference.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Thing' } } } },
            204: { description: 'Choice.', content: { 'application/json': { schema: { oneOf: [{ type: 'string' }, { type: 'integer' }] } } } },
            205: { description: 'Described.', content: { 'application/json': { schema: { type: 'string', description: 'Body text.' } } } },
            206: { description: 'Opaque.', content: { 'application/octet-stream': {} } },
          },
        },
      },
    },
    components: { schemas: { Thing: { type: 'object', properties: { name: { type: 'string' } } } } },
  }, { version: 'api' })['make-thing/index.html'];
  const doc = dom(html);
  // each representation is one list, anchored on its media type
  const representation = (context) => {
    const list = doc.getElementById(context).parentElement;
    assert.equal(list.firstElementChild.id, context, `${context}: the media type leads its list`);
    return list;
  };
  const media = (status, type) => representation(`response-${status}-body-${type}`);
  // scalar: the schema section holds only the list
  assert.deepEqual(metadata(media(200, 'text-plain')), [['Media type', '`text/plain`'], ['Type', '`string`']]);
  assert.deepEqual(outline(media(200, 'text-plain').parentElement), ['dl.metadata']);
  // object: list, then the property table; the example link precedes the section
  const object = media(201, 'application-json');
  assert.deepEqual(metadata(object).map(([term]) => term), ['Media type', 'Type', 'Required properties in this object']);
  assert.deepEqual(outline(object.parentElement), ['dl.metadata', 'div.table.fields.block']);
  assert.ok(object.parentElement.previousElementSibling.matches('p.example-link.button-wrapper'));
  // array: folded item constraints join the same list
  assert.deepEqual(
    metadata(media(202, 'application-json')),
    [['Media type', '`application/json`'], ['Type', '`string[]`'], ['Allowed item values', '`"a"`, `"b"`']],
  );
  // reference and composition keep their disclosures after the list
  const reference = media(203, 'application-json');
  assert.equal(reference.querySelector('a').getAttribute('href'), '/docs/api/schemas/thing');
  assert.equal(textOf(reference.nextElementSibling.querySelector('summary')), 'Properties of Thing');
  const choice = media(204, 'application-json');
  assert.ok(has(metadata(choice), ['Type', '`string | integer`']));
  assert.match(textOf(choice.nextElementSibling.querySelector('summary')), /^One of/);
  // a described root keeps prose before its list
  assert.deepEqual(outline(media(205, 'application-json').parentElement), ['p', 'dl.metadata']);
  assert.equal(textOf(media(205, 'application-json').previousElementSibling), 'Body text.');
  // without a schema there is no section, and the representation's list stands alone
  assert.deepEqual(metadata(media(206, 'application-octet-stream')), [['Media type', '`application/octet-stream`']]);
  [200, 201, 202, 203, 204, 205, 206].forEach((status) => {
    const section = doc.getElementById(`response-${status}`).closest('.response');
    assert.equal(allMetadata(section).filter(([term]) => term === 'Media type').length, 1, status);
    section.querySelectorAll('dl').forEach((list) => {
      assert.ok(!list.id && list.nextElementSibling?.tagName !== 'DL', status);
    });
    section.querySelectorAll('.schema').forEach((schema) => assert.ok(schema.children.length, status));
    if (status === 206) assert.equal(section.querySelector('.schema'), null);
  });
  // request bodies and content parameters compose their representations the same way
  const body = representation('request-body-application-json');
  assert.deepEqual(metadata(body).slice(0, 2), [['Media type', '`application/json`'], ['Type', '`object`']]);
  assert.ok(body.parentElement.matches('.schema'));
  assert.deepEqual(metadata(representation('query-q-text-plain')), [
    ['Media type', '`text/plain`'], ['Type', '`string`'], ['Minimum length', '`1`'], ['Example', '`"abc"`'],
  ]);
});

test('request bodies keep request-level metadata apart from one list per representation', () => {
  const doc = dom(page({
    requestBody: {
      required: true,
      description: 'The document to store.',
      content: {
        'application/json': {
          schema: { type: 'object', properties: { title: { type: 'string' } } },
          example: { title: 'x' },
        },
        'text/html': { schema: { type: 'string', format: 'html' } },
        '*/*': {},
      },
    },
    responses: { 204: { description: 'Stored.' } },
  }));
  const body = [];
  for (let next = doc.getElementById('request-body').nextElementSibling; next && next.tagName !== 'H2';
    next = next.nextElementSibling) body.push(next);
  // request-level metadata and prose come first, in their own list
  assert.deepEqual(body.slice(0, 2).map(({ tagName }) => tagName), ['DL', 'P']);
  assert.deepEqual(metadata(body[0]), [['Request body required', 'yes']]);
  assert.equal(textOf(body[1]), 'The document to store.');
  // each representation is one list led by its anchored media type, then its structure
  const json = doc.getElementById('request-body-application-json').parentElement;
  assert.deepEqual(metadata(json), [['Media type', '`application/json`'], ['Type', '`object`']]);
  assert.deepEqual(outline(json.parentElement), ['dl.metadata', 'div.table.fields.block']);
  const link = json.parentElement.previousElementSibling;
  assert.deepEqual(outline(link), ['a.button.secondary']);
  assert.deepEqual([link.className, link.firstElementChild.getAttribute('href'), link.firstElementChild.title, textOf(link)], [
    'example-link button-wrapper', '#request-body-application-json-examples',
    'View application/json examples', 'View application/json examples',
  ]);
  const html = doc.getElementById('request-body-text-html').parentElement;
  assert.deepEqual(metadata(html), [['Media type', '`text/html`'], ['Type', '`string`'], ['Format', '`html`']]);
  assert.deepEqual(outline(html.parentElement), ['dl.metadata']);
  assert.deepEqual(metadata(doc.getElementById('request-body-any').parentElement), [['Media type', '`*/*`']]);
  const sections = body.flatMap((element) => [element, ...element.querySelectorAll('*')]);
  assert.equal(sections.filter((element) => element.tagName === 'DT' && textOf(element) === 'Media type').length, 3);
  assert.ok(!sections.some((element) => element.tagName === 'H3'));
  assert.ok(!sections.some((element) => element.matches('.schema') && !element.children.length));
  // the code rail still links to the representation
  assert.ok(doc.querySelector('.code-sample[data-examples="request-body"] a[href="#request-body-application-json"]'));
});
