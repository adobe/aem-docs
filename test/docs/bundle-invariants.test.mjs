import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { parseHTML } from 'linkedom';
import { normalizeOpenApi } from '../../scripts/docs/normalize-openapi.mjs';
import { artifactPath, renderSite } from '../../scripts/docs/openapi-to-html.mjs';
import {
  bundles, headingLevels, ids, links, readBundle, responseSections, tables,
} from './helpers.mjs';

const KIB = 1024;
const sharedHead = await readFile(new URL('../../head.html', import.meta.url), 'utf8');

const loaded = await Promise.all(bundles.map(async (bundle) => {
  const input = await readBundle(bundle.version);
  return {
    ...bundle,
    input,
    model: normalizeOpenApi(input, { version: bundle.version }),
    files: renderSite(input, { version: bundle.version }),
  };
}));

const pages = (files) => Object.entries(files).filter(([name]) => name !== 'nav.html');

loaded.forEach(({
  version, input, model, files, operations, schemas,
}) => {
  test(`${version}: inventory sizes match the bundle`, () => {
    assert.equal(model.operations.length, operations);
    assert.equal(model.schemas.length, schemas);
    const components = Object.keys(input.components.schemas);
    assert.equal(Object.keys(model.schemaNames).length, components.length);
    assert.equal(Object.keys(files).length, operations + schemas + 3);
    assert.ok(files['index.html'] && files['schemas/index.html'] && files['nav.html']);
  });

  test(`${version}: every page has one H1, unique whitespace-free IDs and bounded size`, () => {
    pages(files).forEach(([name, html]) => {
      assert.equal(headingLevels(html).filter((level) => level === 1).length, 1, name);
      const targets = ids(html);
      assert.equal(new Set(targets).size, targets.length, `${name}: duplicate ID`);
      targets.forEach((id) => assert.ok(id && !/\s/.test(id), `${name}: invalid ID "${id}"`));
      const limit = name.startsWith('schemas/') ? 64 * KIB : 96 * KIB;
      assert.ok(Buffer.byteLength(html) <= limit, `${name}: ${Buffer.byteLength(html)} bytes`);
    });
  });

  // .api-reference is the namespace; only the api-nav widget's derived classes keep the prefix
  test(`${version}: generated classes carry no redundant api- prefix`, () => {
    Object.entries(files).forEach(([name, html]) => {
      const { document } = parseHTML(html);
      const prefixed = [...document.querySelectorAll('[class]')]
        .flatMap((element) => [...element.classList])
        .filter((token) => token.startsWith('api-') && !/^api-nav(?:-|$)/.test(token));
      assert.deepEqual([...new Set(prefixed)], [], name);
    });
  });

  test(`${version}: every in-page and cross-page link resolves`, () => {
    Object.entries(files).forEach(([name, html]) => {
      const targets = ids(html);
      links(html).forEach((href) => {
        if (href.startsWith('#')) {
          assert.ok(targets.includes(decodeURIComponent(href.slice(1))), `${name}: ${href}`);
          return;
        }
        if (!href.startsWith('/docs/')) return;
        const url = new URL(href, 'https://example.test');
        assert.ok(url.pathname === model.baseUrl || url.pathname.startsWith(`${model.baseUrl}/`), `${name}: wrong namespace ${href}`);
        const file = url.pathname.endsWith('/nav.html')
          ? 'nav.html' : artifactPath(url.pathname, model.baseUrl);
        assert.ok(files[file], `${name}: unresolved ${href}`);
        if (file !== 'nav.html') assert.ok(!url.pathname.endsWith('.html'), `${name}: ${href}`);
        if (url.hash) {
          assert.ok(ids(files[file]).includes(decodeURIComponent(url.hash.slice(1))), `${name}: ${href}`);
        }
      });
    });
  });

  test(`${version}: root, schema index and navigation list every page`, () => {
    const root = new Set(links(files['index.html']));
    const index = new Set(links(files['schemas/index.html']));
    const nav = new Set(links(files['nav.html']));
    model.operations.forEach(({ url }) => {
      assert.ok(root.has(url), `root: ${url}`);
      assert.ok(nav.has(url), `nav: ${url}`);
    });
    model.schemas.forEach(({ url }) => {
      assert.ok(index.has(url), `schema index: ${url}`);
      assert.ok(nav.has(url), `nav: ${url}`);
    });
  });

  test(`${version}: each normalized response renders one section with its context`, () => {
    model.operations.forEach((op) => {
      const html = files[artifactPath(op.url, model.baseUrl)];
      const sections = responseSections(html);
      assert.equal(sections.length, op.responses.length, op.url);
      sections.forEach((section, index) => {
        const response = op.responses[index];
        const targets = ids(section);
        [response.context, ...response.headers.map((h) => h.context),
          ...response.media.map((m) => m.context)]
          .forEach((context) => assert.ok(targets.includes(context), `${op.url}: ${context}`));
      });
    });
  });

  test(`${version}: aliases share one canonical schema page`, () => {
    const route = (name) => model.schemaNames[name]?.url;
    assert.equal(route('SiteConfig'), `/docs/${version}/schemas/site-config`);
    assert.equal(route('site'), route('SiteConfig'));
    assert.equal(route('cdn'), `/docs/${version}/schemas/cdn-config`);
    assert.ok(!files['schemas/site/index.html']);
    Object.entries(model.schemaNames).forEach(([name, entry]) => {
      assert.ok(files[artifactPath(entry.url, model.baseUrl)], `${name}: ${entry.url}`);
    });
  });

  test(`${version}: field names are row headers or plain names, never headings`, () => {
    pages(files).forEach(([name, html]) => {
      tables(html).forEach(({ rows, rowHeaders, classes }) => {
        rows.forEach(([identity]) => {
          assert.doesNotMatch(identity, /<h[1-6]\b/, `${name}: heading in a field name cell`);
        });
        if (!classes.split(' ').includes('fields')) return;
        rows.slice(1).forEach((cells, index) => {
          const by = rowHeaders[index + 1];
          assert.ok(by, `${name}: field row without a labelled row header`);
          assert.ok(cells[0].includes(` id="${by}"`), `${name}: ${by} labels another cell`);
        });
      });
      assert.doesNotMatch(html, /<section class="field">\s*<h[1-6]\b/, `${name}: field heading`);
    });
  });

  test(`${version}: every page head carries head.html once, after the charset`, () => {
    const squash = (text) => text.replace(/\s+/g, ' ').trim();
    const once = [
      'http-equiv="Content-Security-Policy"', 'name="viewport"', 'src="/scripts/aem.js"',
      'src="/scripts/scripts.js"', 'href="/styles/styles.css"', '<title>', 'name="description"',
      'name="template" content="api-reference"', 'rel="canonical"',
    ];
    pages(files).forEach(([name, html]) => {
      const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
      assert.match(head, /^\s*<meta charset="utf-8">/, `${name}: charset first`);
      assert.ok(squash(head).includes(squash(sharedHead)), `${name}: head.html verbatim`);
      once.forEach((marker) => assert.equal(head.split(marker).length - 1, 1, `${name}: ${marker}`));
      assert.doesNotMatch(head, /rel="icon"/, `${name}: browsers request /favicon.ico`);
    });
  });

  test(`${version}: rendering is deterministic`, () => {
    assert.deepEqual(renderSite(input, { version }), files);
  });

  // D2: headings outline pages, sections and statuses; field names are never headings
  test(`${version}: headings never skip a level and never sit in table cells`, () => {
    pages(files).forEach(([name, html]) => {
      const levels = headingLevels(html);
      levels.slice(1).forEach((level, index) => {
        assert.ok(level <= levels[index] + 1, `${name}: H${levels[index]} → H${level}`);
      });
      tables(html).forEach(({ rows }) => rows.forEach((cells) => cells.forEach((cell) => {
        assert.doesNotMatch(cell, /<h[1-6]\b/, `${name}: heading in a table cell`);
      })));
    });
  });
});
