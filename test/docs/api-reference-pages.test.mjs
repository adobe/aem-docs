import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdtemp, readdir, readFile, rm, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { normalizeOpenApi } from '../../scripts/docs/normalize-openapi.mjs';
import { artifactPath, renderSite } from '../../scripts/docs/openapi-to-html.mjs';
import { accessSchema, sourceOperations } from './aem-fixtures.mjs';
import {
  blocksOf, bundles, dom, ids, links, media, metadata, readBundle, ref, responseSections, textOf,
} from './helpers.mjs';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../..', import.meta.url));

function document() {
  return {
    openapi: '3.1.0',
    info: { title: 'AEM test API', version: 'test', description: 'API description.' },
    tags: [
      { name: 'config', 'x-displayName': 'Site configuration', description: 'Configure sites.' },
      { name: 'source' },
    ],
    'x-tagGroups': [{ name: 'Administration', tags: ['source', 'config'] }],
    paths: {
      '/site': {
        put: {
          operationId: 'updateConfigSite',
          tags: ['config', 'source'],
          requestBody: { content: media(ref('site')) },
          responses: {
            200: {
              description: 'Updated',
              headers: { config: { schema: ref('SiteConfig') } },
              content: media({ type: 'array', items: ref('SiteConfig') }),
            },
          },
        },
      },
    },
    components: {
      schemas: {
        site: {
          type: 'object',
          description: 'Site definition.',
          required: ['access'],
          properties: {
            access: ref('SiteAccessConfig'),
            nested: { type: 'object', properties: { notExpanded: { type: 'string' } } },
          },
        },
        SiteConfig: { ...ref('site'), 'x-tags': ['config'] },
        'access-site': accessSchema,
        SiteAccessConfig: { ...ref('access-site'), 'x-tags': ['config'] },
      },
    },
  };
}

function validateArtifacts(files, model) {
  const routes = [model.baseUrl, `${model.baseUrl}/schemas`,
    ...model.operations.map((op) => op.url), ...model.schemas.map((schema) => schema.url)];
  assert.equal(new Set(routes).size, routes.length);
  assert.equal(Object.keys(files).length, routes.length + 1);
  routes.forEach((url) => {
    const html = files[artifactPath(url, model.baseUrl)];
    assert.ok(html, url);
    assert.ok(html.includes(`<link rel="canonical" href="${url}"/>`), url);
    assert.ok(html.includes(`href="/widgets/api-nav.html?nav=${model.baseUrl}/nav.html"`), url);
    assert.doesNotMatch(html, /class="api-nav"/, url);
  });
  const rootLinks = new Set(links(files['index.html']));
  const schemaLinks = new Set(links(files['schemas/index.html']));
  const navLinks = new Set(links(files['nav.html']));
  model.operations.forEach((op) => {
    assert.ok(rootLinks.has(op.url), `Missing operation in root: ${op.url}`);
    assert.ok(navLinks.has(op.url), `Missing operation in navigation: ${op.url}`);
    const html = files[artifactPath(op.url, model.baseUrl)];
    const sections = responseSections(html);
    assert.equal(sections.length, op.responses.length, op.url);
    if (op.responses.length) {
      assert.ok(html.includes(`<h2 data-examples="${op.responses[0].context}">Response</h2>`), op.url);
    }
    sections.forEach((section, index) => {
      const response = op.responses[index];
      const boundary = index ? ` data-examples="${response.context}"` : '';
      assert.match(section, new RegExp(`^<section class="response">\\s*<h3 class="heading" id="${response.context}"${boundary}>`), op.url);
      assert.equal((section.match(/class="heading"/g) ?? []).length, 1, op.url);
      assert.equal(
        (section.match(/class="table headers fields block" data-block-name="table"/g) ?? []).length,
        response.headers.length ? 1 : 0,
        op.url,
      );
      const targets = ids(section);
      const contexts = [
        response.context,
        ...response.headers.map((header) => header.context),
        ...response.media.map((entry) => entry.context),
      ];
      contexts.forEach((context) => assert.ok(targets.includes(context), `${op.url}: ${context}`));
      response.media.filter((entry) => entry.examples.length).forEach((entry) => {
        assert.ok(section.includes(`href="#${entry.context}-examples"`), op.url);
        assert.ok(!targets.includes(`${entry.context}-examples`), op.url);
      });
      assert.doesNotMatch(section, /class="code-sample"/, op.url);
    });
  });
  model.schemas.forEach((schema) => {
    assert.ok(schemaLinks.has(schema.url), `Missing schema in index: ${schema.url}`);
    assert.ok(navLinks.has(schema.url), `Missing schema in navigation: ${schema.url}`);
  });
  Object.entries(files).forEach(([name, html]) => {
    const targets = ids(html);
    assert.equal(new Set(targets).size, targets.length, `Duplicate IDs in ${name}`);
    links(html).filter((href) => href.startsWith('/docs/')).forEach((href) => {
      const url = new URL(href, 'https://example.test');
      assert.ok(url.pathname === model.baseUrl || url.pathname.startsWith(`${model.baseUrl}/`), `${name}: wrong namespace ${href}`);
      const file = url.pathname.endsWith('/nav.html')
        ? 'nav.html' : artifactPath(url.pathname, model.baseUrl);
      assert.ok(files[file], `${name}: unresolved ${href}`);
      if (url.hash) {
        assert.ok(ids(files[file]).includes(decodeURIComponent(url.hash.slice(1))), href);
      }
      if (file !== 'nav.html') assert.ok(!url.pathname.endsWith('.html'), href);
    });
  });
}

test('generates roots, inventories and exactly one canonical schema page for aliases', () => {
  const input = document();
  const before = structuredClone(input);
  const model = normalizeOpenApi(input, { version: 'admin' });
  const files = renderSite(input, { version: 'admin' });
  validateArtifacts(files, model);
  assert.equal(Object.keys(files).length, 6);
  assert.equal(model.schemaNames.SiteConfig, model.schemaNames.site);
  assert.ok(files['schemas/site-config/index.html']);
  assert.ok(!files['schemas/site/index.html']);
  assert.ok(!files['schemas/access-site/index.html']);
  assert.match(files['schemas/site-config/index.html'], /<h1 id="schema">SiteConfig<\/h1>/);
  assert.match(files['schemas/site-config/index.html'], /<code>site<\/code>, <code>SiteConfig<\/code>/);
  assert.match(files['index.html'], /Site configuration/);
  assert.match(files['index.html'], /Configure sites/);
  assert.ok(files['nav.html'].indexOf('group">source')
    < files['nav.html'].indexOf('group">Site configuration'));
  assert.deepEqual(input, before);
  assert.deepEqual(files, renderSite(input, { version: 'admin' }));
});

test('links body, array-item, field, parameter and header references with bounded local exploration', () => {
  const input = document();
  input.paths['/site'].put.parameters = [
    { in: 'query', name: 'config', schema: ref('site') },
  ];
  const files = renderSite(input, { version: 'api' });
  const html = files['update-config-site/index.html'];
  assert.match(html, /<dt>Type<\/dt><dd><code><a href="\/docs\/api\/schemas\/site-config">SiteConfig<\/a>/);
  assert.match(html, /<code>access<\/code>/);
  assert.match(html, /href="\/docs\/api\/schemas\/site-access-config">SiteAccessConfig/);
  assert.match(html, /id="query-config"/);
  assert.match(html, /SiteConfig<\/a>\[\]<\/code>/);
  assert.match(html, /notExpanded/);
  assert.match(files['schemas/site-config/index.html'], /notExpanded/);
  assert.match(html, /<details/);
  assert.doesNotMatch(html, /<h[5-6]/);
  validateArtifacts(files, normalizeOpenApi(input, { version: 'api' }));
});

test('keeps styled inventories as complete ordered lists and real schema tables', () => {
  const input = document();
  input.components.schemas.Undescribed = { type: 'string' };
  const files = renderSite(input, { version: 'api' });
  const model = normalizeOpenApi(input, { version: 'api' });
  const rootHtml = files['index.html'];
  assert.match(rootHtml, /<h2 class="tag-group" id="administration">Administration<\/h2>/);
  // each tag row: heading and description beside the operation list, in tag group order
  const rootRows = [...rootHtml.matchAll(/<section class="row">([\s\S]*?)<\/section>/g)]
    .map(([, row]) => row);
  assert.equal(rootRows.length, 3);
  assert.match(rootRows[1], /<div class="row-text">\s*<h3 id="source">source<\/h3>\s*<\/div>/);
  assert.match(rootRows[2], /<h3 id="config">Site configuration<\/h3>\s*<p>Configure sites\.<\/p>\s*<\/div>/);
  rootRows.slice(1).forEach((row) => {
    assert.ok(row.includes('<ul class="operations aside" role="list">'
      + '<li><a class="endpoint" href="/docs/api/update-config-site">'
      + '<span class="http-method http-put">PUT</span> <span class="endpoint-text">'
      + '<span class="op-summary">updateConfigSite</span> '
      + '<code class="http-path">/<wbr>site</code></span></a></li></ul>'));
  });
  // landing links reuse the endpoint box without the operation page's copyable data-url
  assert.doesNotMatch(rootHtml, /data-url=|<p class="endpoint"/);
  const indexHtml = files['schemas/index.html'];
  assert.match(indexHtml, /<div class="table schema-index">\s*<table>/);
  assert.match(indexHtml, /<tr><td>Schema<\/td><td>Description<\/td><\/tr>/);
  const rows = [...indexHtml.matchAll(/<tr><td><a href="([^"]+)">([^<]+)<\/a><\/td><td>([\s\S]*?)<\/td><\/tr>/g)];
  assert.deepEqual(
    rows.map(([, url, name]) => [url, name]),
    model.schemas.map((schema) => [schema.url, schema.name]),
  );
  assert.equal(rows.find(([, , name]) => name === 'Undescribed')[3], '');
  validateArtifacts(files, model);
});

test('introduces the API root with its overview facts and an unbroken heading outline', () => {
  const input = document();
  input.servers = [{ url: 'https://api.aem.live' }, { url: 'https://alt.aem.live', description: 'Staging' }];
  input.info.license = { name: 'Apache 2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0.html' };
  input.paths['/untagged'] = { get: { operationId: 'index' } };
  input.paths['/unknown'] = { get: { operationId: 'getUnknown', tags: ['unknown'] } };
  const html = renderSite(input, { version: 'api' })['index.html'];
  assert.match(html, /class="content overview" id="api-main"/);
  assert.match(html, /<h1 id="api-root">AEM test API<\/h1>\s*<p>API description\.<\/p>\s*<\/div>/);
  const facts = html.match(/<dl class="metadata aside">([\s\S]*?)<\/dl>/)[1];
  assert.deepEqual([...facts.matchAll(/<dt>([^<]+)<\/dt><dd>([\s\S]*?)<\/dd>/g)].map(([, term, value]) => [term, value]), [
    ['Version', 'test'],
    ['Base URL', '<code>https://api.aem.live</code>'],
    ['Staging', '<code>https://alt.aem.live</code>'],
    ['Operations', '3'],
    ['Schemas', '<a href="/docs/api/schemas">2 schemas</a>'],
    ['License', '<a href="https://www.apache.org/licenses/LICENSE-2.0.html">Apache 2.0</a>'],
  ]);
  // tags outside a named group take the group heading level, as in the navigation
  assert.match(html, /<h2 id="unknown">unknown<\/h2>/);
  assert.match(html, /<h2 id="other-operations">Other operations<\/h2>/);
  const levels = [...html.matchAll(/<h([1-6])\b/g)].map(([, level]) => Number(level));
  levels.slice(1).forEach((level, index) => assert.ok(level <= levels[index] + 1, `h${levels[index]} to h${level}`));

  input.info.license = { name: 'Custom <license>', url: 'data:text/html,unsafe' };
  delete input.info.version;
  const unsafeHtml = renderSite(input, { version: 'api' })['index.html'];
  const unsafe = unsafeHtml.slice(unsafeHtml.indexOf('<main'));
  assert.match(unsafe, /<dt>License<\/dt><dd>Custom &lt;license&gt;<\/dd>/);
  assert.doesNotMatch(unsafe, /<dt>Version<\/dt>|href="data:/);
});

test('represents every operation once even with multiple, undeclared or absent tags', () => {
  const input = document();
  input.paths['/untagged'] = { get: { operationId: 'index' } };
  input.paths['/unknown'] = { trace: { operationId: 'getHTTPStatus', tags: ['unknown'] } };
  const model = normalizeOpenApi(input, { version: 'api' });
  const files = renderSite(input, { version: 'api' });
  validateArtifacts(files, model);
  assert.ok(files['index/index.html']);
  assert.ok(files['get-http-status/index.html']);
  assert.match(files['nav.html'], /Other operations/);
  assert.match(files['nav.html'], /group">unknown/);
  assert.equal((files['nav.html'].match(/href="\/docs\/api\/update-config-site"/g) ?? []).length, 2);
  assert.throws(() => renderSite(input), /Expected version admin or api/);
});

test('preserves allOf conflicts, reference siblings, recursive links and dictionaries', () => {
  const input = document();
  input.components.schemas.Recursive = {
    ...ref('SiteConfig'),
    type: 'object',
    description: 'A constrained reference.',
    properties: { next: ref('Recursive') },
    additionalProperties: ref('SiteAccessConfig'),
    allOf: [
      { required: ['same'], properties: { same: { type: 'string' } } },
      { properties: { same: { type: 'integer' } } },
    ],
  };
  const files = renderSite(input, { version: 'api' });
  const html = files['schemas/recursive/index.html'];
  assert.match(html, /A constrained reference/);
  assert.match(html, /<dt>Type constraint at this reference<\/dt><dd><code>object<\/code>/);
  assert.match(html, /<dt>Type<\/dt><dd><code>string<\/code>/);
  assert.match(html, /<dt>Type<\/dt><dd><code>integer<\/code>/);
  assert.equal(ids(html).filter((id) => id === 'field-same').length, 1);
  assert.match(html, /Required in this object/);
  assert.match(html, /data-required="false"><dt>Required in this object<\/dt><dd>no/);
  assert.match(html, /href="\/docs\/api\/schemas\/recursive">Recursive/);
  assert.match(html, /Dictionary values/);
  assert.match(html, /href="\/docs\/api\/schemas\/site-access-config"/);
  validateArtifacts(files, normalizeOpenApi(input, { version: 'api' }));
});

test('links array-item types in null unions and dictionary value types without child expansion', () => {
  const input = document();
  input.components.schemas.site.properties.items = {
    type: ['array', 'null'], items: ref('SiteAccessConfig'),
  };
  input.components.schemas.site.properties.labels = {
    type: 'object', additionalProperties: ref('SiteAccessConfig'),
  };
  const files = renderSite(input, { version: 'api' });
  const html = files['update-config-site/index.html'];
  assert.match(html, /SiteAccessConfig<\/a>\[\] \| null/);
  assert.match(html, /object \(values: <a href="\/docs\/api\/schemas\/site-access-config"/);
  assert.match(html, /notExpanded/);
  validateArtifacts(files, normalizeOpenApi(input, { version: 'api' }));
});

test('uses effective parameters, servers, permissions and referenced bodies from the model', () => {
  const input = document();
  input.paths['/site'].parameters = [
    {
      in: 'query', name: 'limit', description: 'Inherited limit', schema: { type: 'integer' },
    },
  ];
  Object.assign(input.paths['/site'].put, {
    'x-permissions': ['config:write'],
    servers: [
      { url: 'https://effective.example.test' },
      { url: 'https://alternate.example.test/{site}', description: '<Alternate & label>' },
      { url: 'https://third.example.test' },
    ],
    parameters: [
      {
        in: 'query', name: 'limit', description: 'Overridden limit', schema: { type: 'string' },
      },
    ],
    requestBody: { $ref: '#/components/requestBodies/Config' },
    description: 'See [config](#schema/site) and [update](#tag/config/operation/updateConfigSite).',
  });
  input.components.requestBodies = { Config: { description: 'Referenced body', content: media(ref('site')) } };
  const html = renderSite(input, { version: 'api' })['update-config-site/index.html'];
  assert.match(html, /Overridden limit/);
  assert.doesNotMatch(html, /Inherited limit/);
  assert.match(html, /https:\/\/effective.example.test/);
  assert.match(html, /<dl class="metadata servers"><div><dt>Base URL<\/dt><dd><code>https:\/\/effective.example.test<\/code><\/dd><\/div>/);
  assert.match(html, /<dt>&lt;Alternate &amp; label&gt;<\/dt><dd><code>https:\/\/alternate.example.test\/\{site\}<\/code>/);
  assert.match(html, /<dt>Alt<\/dt><dd><code>https:\/\/third.example.test<\/code>/);
  assert.match(html, /<dt>Required permissions<\/dt><dd><code>config:write/);
  assert.match(html, /Referenced body/);
  assert.match(html, /href="\/docs\/api\/schemas\/site-config">config/);
  assert.match(html, /href="\/docs\/api\/update-config-site">update/);
});

test('renders real API Service media/examples and AEM schema fixtures through production integration', () => {
  const input = document();
  input.paths = { '/{org}/sites/{site}/source/{path}': sourceOperations };
  input.components.securitySchemes = {
    AuthCookie: { type: 'apiKey', in: 'cookie', name: 'auth_token' },
  };
  const model = normalizeOpenApi(input, { version: 'api' });
  const files = renderSite(input, { version: 'api' });
  validateArtifacts(files, model);
  assert.match(files['get-source-document/index.html'], /<code>\*\/\*<\/code>/);
  assert.match(files['get-source-document/index.html'], /<code>binary<\/code>/);
  assert.match(files['get-source-document/index.html'], /<dt>permissions<\/dt><dd><code>preview:read/);
  assert.doesNotMatch(files['get-source-document/index.html'], /<dt>scopes/);
});

test('the CLI writes every artifact, including nested pages, and requires explicit inputs', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'aem-api-pages-'));
  try {
    const input = document();
    const specFile = path.join(directory, 'openapi.json');
    const htmlDir = path.join(directory, 'html');
    await writeFile(specFile, JSON.stringify(input));
    const env = {
      ...process.env, API_VERSION: 'api', OPENAPI_SPEC_FILE: specFile, OPENAPI_HTML_DIR: htmlDir,
    };
    const cli = (variables) => execute(process.execPath, ['scripts/docs/openapi-to-html.mjs'], { cwd: root, env: variables });
    await cli(env);
    const files = renderSite(input, { version: 'api' });
    const written = (await readdir(htmlDir, { recursive: true })).filter((name) => name.endsWith('.html'));
    assert.deepEqual(written.sort(), Object.keys(files).sort());
    assert.ok(written.some((name) => name.includes('/')), 'Operation and schema pages are nested');
    await Promise.all(Object.entries(files).map(async ([name, html]) => {
      assert.equal(await readFile(path.join(htmlDir, name), 'utf8'), html, name);
    }));
    await Promise.all(['API_VERSION', 'OPENAPI_SPEC_FILE', 'OPENAPI_HTML_DIR'].map((name) => {
      const missing = { ...env };
      delete missing[name];
      return assert.rejects(cli(missing), /Set API_VERSION, OPENAPI_SPEC_FILE and OPENAPI_HTML_DIR/, name);
    }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('renders both full frozen AEM bundles with valid artifacts, metadata and tables', async () => {
  await Promise.all(bundles.map(async ({ version }) => {
    const input = await readBundle(version);
    const model = normalizeOpenApi(input, { version });
    const files = renderSite(input, { version });
    validateArtifacts(files, model);
    Object.entries(files).forEach(([file, html]) => {
      // each list is nonempty; each pair is one dt and one dd, with only a target or requiredness
      dom(html).querySelectorAll('dl.metadata').forEach((list) => {
        assert.ok(metadata(list).length, file);
        [...list.children].forEach((pair) => [...pair.attributes].forEach(({ name, value }) => {
          assert.ok(name === 'id' || (name === 'data-required' && /^(true|false)$/.test(value)), `${file}: ${name}`);
        }));
      });
      assert.doesNotMatch(html, /<(?:h[1-6]|span)[^>]*>[^<]*<dl/, file);
    });
    const update = files['update-config-site/index.html'];
    assert.match(update, new RegExp(`href="/docs/${version}/schemas/site-config"`));
    assert.match(
      files['schemas/site-config/index.html'],
      new RegExp(`href="/docs/${version}/schemas/access-config"`),
    );
    const schemaTable = files['schemas/site-config/index.html']
      .match(/<div class="table fields block" data-block-name="table">\s*<table>([\s\S]*?)<\/table>/);
    const bodyTable = update.match(/<div class="table fields block" data-block-name="table">\s*<table>([\s\S]*?)<\/table>/);
    assert.ok(schemaTable, `${version}: canonical SiteConfig table`);
    assert.ok(bodyTable, `${version}: request SiteConfig table`);
    assert.equal(bodyTable[1].replaceAll('request-body-application-json', 'field'), schemaTable[1]);
    Object.entries(files).forEach(([name, html]) => {
      let depth = 0;
      [...html.matchAll(/<\/?table\b[^>]*>/g)].forEach(([tag]) => {
        depth += tag.startsWith('</') ? -1 : 1;
        assert.ok(depth >= 0 && depth <= 1, `${version}/${name}: nested or unbalanced table`);
      });
      assert.equal(depth, 0, name);
    });
    if (version === 'admin') {
      const request = files['batch-code/index.html'];
      const properties = [...dom(request).querySelectorAll('details')]
        .find((details) => textOf(details.querySelector('summary')) === 'Properties of changeEventBody');
      assert.deepEqual(blocksOf(properties).slice(0, 4), ['summary', 'Change event payload', [
        ['Type', '`not specified`'], ['Required properties in this object', '`"changes"`'],
      ], 'div.table.fields.block']);
      assert.match(request, /<div class="field-name" id="request-body-application-json-changes">[\s\S]*?<\/div><dl class="metadata"><div><dt>Type[\s\S]*?<\/dl><\/div><\/th><td><p>array of changes<\/p>/);
      assert.match(request, /id="request-body-application-json-changes\[\]"/);
      assert.match(request, /id="request-body-application-json-\*"/);
      assert.match(request, /<section class="children"><p>Array items<\/p>/);
      assert.match(request, /<section class="children"><p>Dictionary values<\/p>/);
      assert.doesNotMatch(request, /<dt>Referenced schema|Array item structure|Value of an additional property/);
      const schema = files['schemas/change-event-body/index.html'];
      assert.match(schema, /<h1 id="schema">changeEventBody<\/h1>/);
      assert.match(schema, /<section class="schema"><p>Change event payload<\/p>\s*<dl class="metadata"><div><dt>Type<\/dt><dd><code>not specified<\/code>/);
      const canonicalTable = schema.match(/<div class="table fields block" data-block-name="table">\s*<table>([\s\S]*?)<\/table>/)[1];
      const requestTable = request.match(/<div class="table fields block" data-block-name="table">\s*<table>([\s\S]*?)<\/table>/)[1];
      assert.equal(requestTable.replaceAll('request-body-application-json', 'field'), canonicalTable);
      ['field-source', 'field-baseRef', 'field-changes', 'field-changes[]', 'field-*']
        .forEach((id) => assert.ok(ids(schema).includes(id), id));
    }
  }));
});
