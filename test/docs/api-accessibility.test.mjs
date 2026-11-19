import assert from 'node:assert/strict';
import { test } from 'node:test';
import decorateTable from '../../blocks/table/table.js';
import { renderSite } from '../../scripts/docs/openapi-to-html.mjs';
import {
  bundles, ids, links, readBundle, tables,
} from './helpers.mjs';

test('nested tables are emitted as table blocks and use existing column-header decoration', async () => {
  const bundle = await readBundle('api');
  const html = Object.values(renderSite(bundle, { version: 'api' })).join('\n');
  const generated = tables(html);
  assert.equal(generated.length, (html.match(/<div class="table /g) ?? []).length);
  generated.forEach(({ rows, rowHeaders }) => {
    assert.ok(rows.length >= 2, 'A header row and at least one body row');
    rows.forEach((cells) => assert.equal(cells.length, 2, 'Every row has two cells'));
    assert.equal(rows[0][1], 'Description');
    assert.equal(rowHeaders[0], null, 'The column header row is decorated by the table block');
    if (rows[0][0] === 'Schema') return;
    rows.slice(1).forEach((cells, index) => {
      const label = rowHeaders[index + 1];
      assert.ok(label, 'Field rows start with a labelled row header');
      assert.ok(cells[0].includes(` id="${label}"`), `Row header is named by its own field: ${label}`);
    });
  });
  const kind = (label) => generated.filter(({ rows }) => rows[0][0] === label);
  [['Header', 'headers fields block'], ['Property', 'fields block']].forEach(([label, classes]) => {
    assert.ok(kind(label).length, `${label} tables are generated`);
    kind(label).forEach((table) => {
      assert.equal(table.classes, classes, 'Nested tables are emitted as blocks');
      assert.equal(table.attributes, 'data-block-name="table"');
    });
  });
  assert.ok(kind('Parameter').length);
  kind('Parameter').forEach((table) => {
    assert.equal(table.classes, 'fields', 'Section-level tables are left to decorateBlocks');
    assert.equal(table.attributes, '');
  });
  assert.deepEqual(
    [...new Set(generated.map(({ rows }) => rows[0][0]))].sort(),
    ['Header', 'Parameter', 'Property', 'Schema'],
  );

  const headers = [];
  const contents = [{ tagName: 'H4', id: 'request-body-application-json-name' }, { tagName: 'DL' }];
  const row = {
    cells: [{ childNodes: contents }, { childNodes: [{ tagName: 'P' }] }],
  };
  const block = {
    querySelectorAll(selector) {
      assert.equal(selector, 'tr');
      return [{
        cells: ['Property', 'Description'].map((text) => ({
          childNodes: [text],
          replaceWith(header) { headers.push(header); },
        })),
      }, row];
    },
  };
  const original = global.document;
  global.document = {
    createElement(tag) {
      assert.equal(tag, 'th');
      return { append(...children) { this.children = children; } };
    },
  };
  try {
    decorateTable(block);
    assert.deepEqual(
      headers.map((header) => [header.scope, header.children[0]]),
      [['col', 'Property'], ['col', 'Description']],
    );
    assert.equal(row.cells[0].childNodes, contents);
    assert.equal(row.cells[0].childNodes[0].id, 'request-body-application-json-name');
  } finally {
    if (original === undefined) delete global.document;
    else global.document = original;
  }
});

function document() {
  return {
    openapi: '3.1.0',
    info: { title: 'Accessible API', version: 'test' },
    paths: {
      '/example': {
        post: {
          operationId: 'testExamples',
          security: [{ Token: [] }],
          parameters: [{
            in: 'query',
            name: 'filter',
            content: { 'application/json': { example: { title: 'Filter example' } } },
          }],
          requestBody: {
            content: {
              'application/json': {
                schema: { type: 'object' },
                examples: {
                  first: { summary: 'A "quoted" example', value: { enabled: false } },
                  second: { value: { enabled: true } },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Success',
              content: {
                'application/json': { example: { ok: true } },
                'text/yaml': { example: 'ok: true\n' },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: { SiteConfig: { properties: { title: { type: 'string' } } } },
      securitySchemes: { Token: { type: 'http', scheme: 'bearer' } },
    },
  };
}

function checkSemantics(files) {
  Object.entries(files).filter(([name]) => name !== 'nav.html').forEach(([name, html]) => {
    assert.match(html, /<html lang="en">/, name);
    assert.equal((html.match(/<main\b/g) ?? []).length, 1, name);
    assert.match(html, /class="skip-link" href="#api-main">Skip to API content/, name);
    assert.ok(html.indexOf('class="skip-link"') < html.indexOf('<header>'), name);
    let content = html.includes('class="code-rail"') ? 'content' : 'content no-examples';
    if (name === 'index.html') content = 'content overview';
    assert.ok(html.includes(`class="${content}" id="api-main" tabindex="-1"`), name);
    assert.ok(html.indexOf('class="navigation"') < html.indexOf('id="api-main"'), name);
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1, name);
    const targets = ids(html);
    assert.equal(new Set(targets).size, targets.length, name);
    links(html).filter((href) => href.startsWith('#')).forEach((href) => {
      assert.ok(targets.includes(decodeURIComponent(href.slice(1))), `${name}: ${href}`);
    });
    const responses = [...html.matchAll(/<h3 class="heading" id="([^"]+)"( data-examples="[^"]*")?>([\s\S]*?)<\/h3>/g)];
    assert.equal((html.match(/<section class="response">/g) ?? []).length, responses.length, name);
    if (responses.length) {
      assert.ok(html.includes(`<h2 data-examples="${responses[0][1]}">Response</h2>`), name);
    }
    responses.forEach(([, id, boundary, heading], index) => {
      assert.equal(boundary, index ? ` data-examples="${id}"` : undefined, `${name}: ${id}`);
      const status = id.slice('response-'.length);
      assert.equal(heading, `<span class="status-badge status-${status[0]}xx">${status}</span>`, name);
      assert.ok(html.includes('<section class="response">\n'
        + `      <h3 class="heading" id="${id}"`), name);
    });
    if (html.includes('class="code-rail"')) {
      assert.ok(html.indexOf('id="api-main"') < html.indexOf('class="code-rail"'), name);
      assert.match(html, /class="code-rail" role="complementary" aria-label="Request and response examples"/, name);
      assert.match(html, /<h2>Examples<\/h2>/, name);
      const samples = [...html.matchAll(/<pre([^>]*)><code class="language-(?:json|yaml)">/g)];
      assert.ok(samples.length, name);
      samples.forEach(([, attrs]) => {
        assert.match(attrs, /role="region"/, name);
        assert.match(attrs, /aria-label="[^"]+"/, name);
        assert.match(attrs, /tabindex="0"/, name);
      });
    }
  });
}

test('all page types have a skip target and coherent navigation/content/example source order', () => {
  checkSemantics(renderSite(document(), { version: 'api' }));
});

test('examples link in both directions to their exact media context without changing payloads', () => {
  const html = renderSite(document(), { version: 'api' })['test-examples/index.html'];
  [
    'request-body-application-json',
    'response-200-body-application-json',
    'response-200-body-text-yaml',
  ].forEach((context) => {
    assert.match(html, new RegExp(`href="#${context}-examples"`));
    assert.match(html, new RegExp(`id="${context}-examples"`));
    assert.match(html, new RegExp(`href="#${context}"`));
  });
  assert.equal((html.match(/id="request-body-application-json-examples"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /href="#query-filter-application-json-examples"/);
  assert.match(html, /aria-label="POST Request: A &quot;quoted&quot; example \(application\/json\)"/);
  assert.ok(html.includes('<span class="title"><span class="http-method http-post">POST</span> '
    + '<a href="#request-body-application-json"><span class="name">Request: A "quoted" example</span></a> '
    + '<span class="media">(application/json)</span></span>'));
  assert.match(html, /<code class="language-json">\{\n {2}"enabled": false\n\}/);
  assert.match(html, /<code class="language-yaml">ok: true\n<\/code>/);
  assert.ok(html.indexOf('id="operation"') < html.indexOf('class="endpoint"'));
  assert.match(html, /Authentication/);
  assert.match(html, /bearer/);
});

test('operation hierarchy and example captions retain headings, targets and region labels', () => {
  const html = renderSite(document(), { version: 'api' })['test-examples/index.html'];
  assert.match(html, /<h1 id="operation">testExamples<\/h1>\s*<p class="endpoint">/);
  assert.match(html, /<h2 id="request-body" data-examples="request-body">Request body<\/h2>/);
  assert.match(html, /data-required="false"><dt>Request body required<\/dt><dd>no/);
  assert.match(html, /<dl class="metadata"><div id="request-body-application-json"><dt>Media type<\/dt>/);
  assert.match(html, /<h3 class="heading" id="response-200"><span class="status-badge status-2xx">200<\/span><\/h3>\s*<div class="description"><p>Success<\/p><\/div>/);
  assert.ok(html.includes('<span class="title"><span class="http-method http-post">POST</span> '
    + '<a href="#response-200-body-application-json"><span class="name">Response</span></a> '
    + '<span class="code-status status-2xx">200</span> <span class="media">(application/json)</span></span>'));
  assert.match(html, /aria-label="POST Response 200 \(application\/json\)" tabindex="0"/);
  assert.match(html, /aria-label="POST Response 200 \(text\/yaml\)" tabindex="0"/);
  checkSemantics({ 'test-examples/index.html': html });
});

test('semantic targets and example associations resolve in both complete AEM baselines', async () => {
  await Promise.all(bundles.map(async ({ version }) => {
    const input = await readBundle(version);
    checkSemantics(renderSite(input, { version }));
  }));
});
