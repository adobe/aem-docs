import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';

export const fixtures = process.env.API_CONTRACT_BASELINE_DIR
  || fileURLToPath(new URL('fixtures', import.meta.url));

export const bundles = [
  { version: 'admin', operations: 116, schemas: 96 },
  { version: 'api', operations: 60, schemas: 74 },
];

export async function readBundle(version) {
  return JSON.parse(await readFile(path.join(fixtures, 'bundles', `${version}.json`), 'utf8'));
}

/** Reverses the generator's attribute escaping; `&amp;` last so `&amp;lt;` stays `&lt;`. */
export const decode = (value) => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');

export const ids = (html) => [...html.matchAll(/<[a-z][^>]*\sid="([^"]*)"[^>]*>/gi)]
  .map((match) => decode(match[1]));

export const links = (html) => [...html.matchAll(/<(?:a|link)\b[^>]*\shref="([^"]+)"/g)]
  .map((match) => decode(match[1]));

export const ref = (name) => ({ $ref: `#/components/schemas/${name}` });

export const media = (schema) => ({ 'application/json': { schema } });

/** A minimal OpenAPI 3.1 document; `paths` and `schemas` replace the defaults. */
export function openapi({ paths, schemas = {}, ...rest } = {}) {
  return {
    openapi: '3.1.0',
    info: { title: 'Test API', version: 'test' },
    servers: [{ url: 'https://api.example.test' }],
    paths: paths ?? { '/thing': { get: { operationId: 'getThing', responses: {} } } },
    components: { schemas },
    ...rest,
  };
}

/** The outer HTML of each `<section class="response">`, in order. */
export function responseSections(html) {
  const sections = [];
  const stack = [];
  [...html.matchAll(/<\/?section\b[^>]*>/g)].forEach((match) => {
    if (match[0].startsWith('</')) {
      const opening = stack.pop();
      if (!opening) throw Error('Unexpected section closing tag');
      if (opening[0] === '<section class="response">') {
        sections.push(html.slice(opening.index, match.index + match[0].length));
      }
    } else {
      stack.push(match);
    }
  });
  if (stack.length) throw Error('Unclosed section');
  return sections;
}

/**
 * Generated table blocks with their classes, block attributes and cell structure. `rows`
 * holds each row's cell contents; `rowHeaders` holds, per row, its leading row header's
 * `aria-labelledby` value, or null when the row starts with a data cell.
 * Generated tables never nest, so a non-greedy match finds each table's end.
 */
export const tables = (html) => [
  ...html.matchAll(/<div class="table([^"]*)"([^>]*)>\s*<table>([\s\S]*?)<\/table>/g),
].map(([, classes, attributes, body]) => {
  const rows = [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(([, row]) => [
    ...row.matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/g),
  ]);
  return {
    classes: classes.trim(),
    attributes: attributes.trim(),
    rows: rows.map((cells) => cells.map(([, , , content]) => content)),
    rowHeaders: rows.map(([first]) => (first?.[1] === 'th' && /\bscope="row"/.test(first[2])
      ? (first[2].match(/aria-labelledby="([^"]*)"/)?.[1] ?? '') : null)),
  };
});

/** Heading levels in document order, e.g. [1, 2, 3, 4]. */
export const headingLevels = (html) => [...html.matchAll(/<h([1-6])\b/g)].map(([, level]) => Number(level));

const root = new URL('../../', import.meta.url);

async function cssFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    if (entry.isDirectory()) return cssFiles(new URL(`${entry.name}/`, directory));
    return entry.name.endsWith('.css') ? [new URL(entry.name, directory)] : [];
  }));
  return files.flat();
}

/** Every shipped stylesheet as `{ name, source }`, comments removed; `name` is repo-relative. */
export async function stylesheets() {
  const urls = (await Promise.all(['styles/', 'blocks/', 'widgets/']
    .map((directory) => cssFiles(new URL(directory, root))))).flat();
  return Promise.all(urls.map(async (url) => ({
    name: url.pathname.slice(root.pathname.length),
    source: (await readFile(url, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, ''),
  })));
}

/** Innermost CSS rules, including those inside at-rules, with each selector list normalized. */
export const cssRules = (source) => [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, selectors, body]) => ({
    selectors: selectors.trim().split(',').map((selector) => selector.trim().replace(/\s+/g, ' ')),
    declarations: Object.fromEntries(body.split(';').map((declaration) => declaration.trim())
      .filter(Boolean).map((declaration) => {
        const colon = declaration.indexOf(':');
        return [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()];
      })),
  }));

/** The declarations of the rules whose selector list contains `selector`, merged in order. */
export const declarations = (source, selector) => Object.assign({}, ...cssRules(source)
  .filter(({ selectors }) => selectors.includes(selector)).map((rule) => rule.declarations));

/** A top-level function declaration's source, for running it in isolation (without `export`). */
export function functionSource(source, name) {
  const match = source.match(new RegExp(`^(?:export )?(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`, 'm'));
  if (!match) throw Error(`${name} is no longer a top-level function declaration; update this test`);
  return match[0].replace(/^export /, '');
}

/** A parsed page. linkedom has no `table.rows` or `tr.cells`; query `tr` and use `children`. */
export const dom = (html) => parseHTML(html).document;

const inline = (node) => {
  if (node.nodeType === 3) return node.textContent.replace(/\s+/g, ' ');
  if (node.tagName === 'CODE') return `\`${node.textContent}\``;
  return [...node.childNodes].map(inline).join('');
};

/** Visible text with code in backticks; whitespace collapses outside code only. */
export const textOf = (element) => inline(element).trim();

/** A metadata list as [term, value] pairs; each pair must be exactly one `dt` then one `dd`. */
export function metadata(list) {
  if (list?.tagName !== 'DL') throw Error(`Expected a metadata list, found ${list?.tagName}`);
  return [...list.children].map((pair) => {
    const tags = [...pair.children].map(({ tagName }) => tagName).join(' ');
    if (pair.tagName !== 'DIV' || tags !== 'DT DD') throw Error(`Malformed metadata pair: ${pair.outerHTML}`);
    return [textOf(pair.children[0]), textOf(pair.children[1])];
  });
}

/** Every metadata pair under an element, in document order. */
export const allMetadata = (element) => [...element.querySelectorAll('dl.metadata')].flatMap(metadata);

/** The body rows of a generated table as [first cell, second cell]. */
export const bodyRows = (table) => [...table.querySelectorAll('tr')].slice(1)
  .map((row) => [...row.children]);

/** Child elements as `tag.class` names, e.g. ['p', 'dl.metadata', 'details.children']. */
export const outline = (element) => [...element.children]
  .map((child) => [child.tagName.toLowerCase(), ...child.classList].join('.'));

/** An HTML fragment, such as a table cell's contents, parsed inside a `div`. */
export const fragment = (html) => dom(`<!doctype html><html><body><div>${html}</div></body></html>`)
  .querySelector('body > div');

/**
 * An element's child blocks in order: paragraphs as text, metadata lists as pairs, disclosures
 * as [summary, ...paragraphs], anything else as `tag.class`.
 */
export const blocksOf = (element) => [...element.children].map((child) => {
  if (child.matches('dl.metadata')) return metadata(child);
  if (child.tagName === 'P') return textOf(child);
  if (child.tagName === 'DETAILS') {
    return [textOf(child.querySelector('summary')), ...[...child.querySelectorAll(':scope > p')].map(textOf)];
  }
  return [child.tagName.toLowerCase(), ...child.classList].join('.');
});

export const blocks = (html) => blocksOf(fragment(html));

/** Every metadata list in an HTML fragment, each as [term, value] pairs. */
export const metadataLists = (html) => [...fragment(html).querySelectorAll('dl.metadata')].map(metadata);
