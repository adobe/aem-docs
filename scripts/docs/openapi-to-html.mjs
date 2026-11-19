/*
 * Copyright 2026 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

/**
 * OpenAPI -> EDS-flavored static HTML.
 *
 *   API_VERSION=api OPENAPI_SPEC_FILE={bundle.json} OPENAPI_HTML_DIR={output directory} \
 *     node scripts/docs/openapi-to-html.mjs
 *
 * Emits the API root, schema index, one page per operation and canonical schema, and nav.html.
 * Pages have three columns: navigation, documentation and the example rail. Field tables use
 * the `table` block and examples the `code-sample` block. All interpretation of the source
 * happens in the normalized model. See scripts/docs/README.md.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeOpenApi } from './normalize-openapi.mjs';
import { fieldPath, fieldAnchor } from './api-reference-anchors.mjs';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (s) => esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * Resolve tag and schema links, or validate an HTTP/HTTPS description destination.
 * @param {string} destination Authored link destination.
 * @param {object} model Normalized OpenAPI model.
 * @returns {string|undefined} Safe destination, or undefined to retain literal source text.
 */
function descriptionLink(destination, model) {
  const internal = destination.match(/^#(tag|schema)\/([^\s]+)$/);
  if (internal) {
    const [, kind, target] = internal;
    const [name, , operationId] = target.split('/').map(decodeURIComponent);
    const entry = kind === 'schema' ? model.schemaNames[name]
      : model.operations.find((operation) => operation.tags.includes(name)
        && (!operationId || operation.operationId === operationId));
    return entry ? entry.url : undefined;
  }
  if (!/^https?:\/\/[^\s<>"'`\\]+$/i.test(destination)
    || [...destination].some((character) => character.charCodeAt(0) < 32
      || character.charCodeAt(0) === 127)) return undefined;
  try {
    return new URL(destination).hostname ? destination : undefined;
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    return undefined;
  }
}

/**
 * Render supported inline syntax without interpreting code or destinations as Markdown.
 * @param {string} s Authored description text.
 * @param {object} model Normalized OpenAPI model.
 * @param {boolean} links Whether links are allowed, false when rendering a link label.
 * @returns {string} Escaped HTML with supported inline formatting.
 */
function mdInline(s, model, links = true) {
  const text = String(s ?? '');
  // One alternation of the supported forms; at a given position, the first listed form wins.
  const tokens = new RegExp([
    // `code`
    /`(?<code>[^`]+)`/.source,
    // <code>code</code> (authored HTML), rendered the same as `code`; no nested markup
    /<code>(?<htmlCode>[^<]+)<\/code>/.source,
    // [label](destination); the destination may contain one level of balanced parentheses
    /\[(?<label>[^\]\n]+)\]\((?<destination>[^()\s]*(?:\([^()\s]*\)[^()\s]*)*)\)/.source,
    // <a href="destination">label</a> (authored HTML), rendered the same as [label](destination);
    // only a single double-quoted href, without entities, and a label without nested markup
    /<a href="(?<htmlDestination>[^"<>&\s]+)">(?<htmlLabel>[^<]+)<\/a>/.source,
    // <https://…> autolink
    /(?<autolink><https?:\/\/[^<>\s]+>)/.source,
    // bare https://… URL
    /(?<url>https?:\/\/[^\s<>"'`]+)/.source,
    // <br> or <br/>
    /(?<br><br\s*\/?>)/.source,
    // Markdown hard break: two or more trailing spaces, or a backslash, before a newline
    /(?<hardBreak>(?: {2,}|\\)\r?\n[ \t]*)/.source,
    // soft newline
    /(?<softBreak>[ \t]*\r?\n[ \t]*)/.source,
  ].join('|'), 'gi');
  let marker = '\0';
  while (text.includes(marker)) marker += '\0';
  // A source-absent marker protects code and links while emphasis spans surrounding text.
  const protectedContent = [];
  const protect = (html) => {
    const index = protectedContent.push(html) - 1;
    return `${marker}${index}${marker}`;
  };
  const output = [];
  let position = 0;
  [...text.matchAll(tokens)].forEach((match) => {
    output.push(esc(text.slice(position, match.index)));
    const [token] = match;
    const { groups } = match;
    // each authored HTML form shares the branch, escaping and link validation of its Markdown form
    const code = groups.code ?? groups.htmlCode;
    const label = groups.label ?? groups.htmlLabel;
    const destination = groups.destination ?? groups.htmlDestination;
    const {
      autolink, url: bareUrl, br, hardBreak, softBreak,
    } = groups;
    if (code !== undefined) {
      output.push(protect(`<code>${esc(code)}</code>`));
    } else if (label !== undefined) {
      const href = links ? descriptionLink(destination, model) : undefined;
      output.push(protect(href
        ? `<a href="${attr(href)}">${mdInline(label, model, false)}</a>` : esc(token)));
    } else if (autolink !== undefined || bareUrl !== undefined) {
      let url = autolink ? token.slice(1, -1) : token;
      if (!autolink) {
        url = url.replace(/[.,;:!?]+$/, '');
        while (url.endsWith(')')
          && (url.match(/\)/g) ?? []).length > (url.match(/\(/g) ?? []).length) {
          url = url.slice(0, -1);
        }
      }
      const href = links ? descriptionLink(url, model) : undefined;
      output.push(protect(href
        ? `<a href="${attr(href)}">${esc(url)}</a>` : esc(autolink ? token : url)));
      if (!autolink) output.push(esc(token.slice(url.length)));
    } else if (br !== undefined || hardBreak !== undefined) {
      output.push(protect('<br>'));
    } else if (softBreak !== undefined) {
      output.push(' ');
    }
    position = match.index + token.length;
  });
  output.push(esc(text.slice(position)));
  const formatted = output.join('')
    .replace(/(?<!\w)(\*\*|__)(?=\S)(.+?\S|\S)\1(?!\w)/g, '<strong>$2</strong>')
    .replace(/(?<!\w)(\*|_)(?=\S)(.+?\S|\S)\1(?!\w)/g, '<em>$2</em>');
  return formatted.split(marker).map((part, index) => (
    index % 2 ? protectedContent[Number(part)] : part
  )).join('');
}

/**
 * Split one blank-line-separated block at runs of two or more `<br>` tags, which authored
 * descriptions use as paragraph breaks. Runs inside backtick code spans are literal code, as in
 * CommonMark, so they do not split.
 * @param {string} block Authored description text without blank lines.
 * @returns {string[]} Paragraph texts; a leading or trailing run produces no empty paragraph.
 */
function splitBreakRuns(block) {
  const paragraphs = [];
  let start = 0;
  // the code span pattern matches the inline formatter's, so a run it consumes is skipped
  [...block.matchAll(/`[^`]+`|(?:<br\s*\/?>\s*){2,}/gi)].forEach((match) => {
    if (match[0].startsWith('`')) return;
    paragraphs.push(block.slice(start, match.index));
    start = match.index + match[0].length;
  });
  paragraphs.push(block.slice(start));
  // a block without a run is one paragraph
  return paragraphs.length > 1 ? paragraphs.filter((paragraph) => paragraph.trim()) : paragraphs;
}

const mdProse = (s, model) => {
  const text = String(s ?? '').trim();
  if (!text) return '';
  return text
    .split(/\n{2,}/)
    .flatMap(splitBreakRuns)
    .map((para) => `<p>${mdInline(para.trim(), model)}</p>`)
    .join('\n');
};

/**
 * Plain-text form of a description, such as the meta description. It is formatted as on the
 * page, so its syntax has one interpretation, then reduced to one line of unescaped text; the
 * caller escapes it with `attr`.
 * @param {string} s Authored description text
 * @param {object} model Normalized OpenAPI model, for resolving description links
 * @returns {string} Single-line plain text
 */
const plain = (s, model) => mdInline(s, model)
  .replace(/<br>/g, ' ')
  .replace(/<[^>]*>/g, '')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * The site's shared head (CSP, viewport, scripts, stylesheet). Generated pages are static
 * files, which EDS does not inject `head.html` into, so each page carries it verbatim.
 */
const sharedHead = (await readFile(new URL('../../head.html', import.meta.url), 'utf8'))
  .trim().split('\n').map((line) => `    ${line}`).join('\n');

/**
 * The template metadata selects the API layout and palette through normal page decoration.
 * @param {string} title Page title
 * @param {string} description Plain-text page description
 * @param {string} url Canonical page URL
 * @returns {string} The page head
 */
function pageHead(title, description, url) {
  return `  <head>
    <meta charset="utf-8">
${sharedHead}
    <title>${esc(title)}</title>
    <meta name="description" content="${attr(description)}">
    <meta name="template" content="api-reference"/>
    <link rel="canonical" href="${attr(url)}"/>
  </head>`;
}

/**
 * Whether `typeLabel()` presents this node's own enum as its type. The type then lists
 * exactly the allowed values, so a separate "Allowed values" entry would repeat it.
 * @param {object} node Normalized schema node
 * @returns {boolean} True when the type label is the node's enum
 */
const enumAsType = (node) => Boolean(node && !node.reference && node.boolean === undefined
  && !node.oneOf.length && !node.anyOf.length && !node.allOf.length
  && !Array.isArray(node.metadata.type) && node.metadata.type !== 'array' && node.metadata.enum);

/**
 * Shallow type expression with its outermost operator, so operands that bind more loosely
 * than their context are parenthesized: union or intersection array items
 * (`(string | null)[]`) and union intersection operands (`(A | B) &amp; C`). Unions are
 * the loosest operator, so their own operands are never wrapped.
 * @param {string} source Normalized schema source
 * @param {object} model Normalized document
 * @param {Set} seen Sources already presented, to stop recursion
 * @param {boolean} asItem Whether this schema is presented as an array's item type
 * @returns {{text: string, kind: string|undefined}} Escaped text and `union`/`intersection`
 */
function typeExpression(source, model, seen = new Set(), asItem = false) {
  const atom = (text) => ({ text, kind: undefined });
  const node = model.nodes[source];
  if (node.reference?.component && node.reference.url) {
    return atom(`<a href="${attr(node.reference.url)}">${esc(node.reference.name)}</a>`);
  }
  if (seen.has(source)) {
    return atom(node.reference?.url
      ? `<a href="${attr(node.reference.url)}">${esc(node.reference.name)}</a>` : 'recursive schema');
  }
  const next = new Set([...seen, source]);
  if (node.reference) return typeExpression(node.reference.schema, model, next, asItem);
  if (node.boolean !== undefined) return atom(node.boolean ? 'any value' : 'no values');
  const { metadata } = node;
  const union = (parts) => (parts.length === 1 ? parts[0]
    : { text: parts.map((part) => part.text).join(' | '), kind: 'union' });
  const array = () => {
    const item = typeExpression(node.items, model, next, true);
    return atom(`${item.kind ? `(${item.text})` : item.text}[]`);
  };
  const parts = (sources) => sources.map((part) => typeExpression(part, model, next));
  if (node.oneOf.length) return union(parts(node.oneOf));
  if (node.anyOf.length) return union(parts(node.anyOf));
  if (node.allOf.length) {
    const operands = parts(node.allOf);
    return operands.length === 1 ? operands[0] : {
      text: operands.map((part) => (part.kind === 'union' ? `(${part.text})` : part.text))
        .join(' &amp; '),
      kind: 'intersection',
    };
  }
  if (Array.isArray(metadata.type)) {
    return union(metadata.type.map((type) => (type === 'array' ? array() : atom(esc(type)))));
  }
  if (metadata.type === 'array') return array();
  if (!asItem && enumAsType(node)) {
    return union(metadata.enum.map((value) => atom(esc(JSON.stringify(value)))));
  }
  if (node.additionalProperties && model.nodes[node.additionalProperties].boolean === undefined) {
    return atom(`${esc(metadata.type ?? 'not specified')} (values: ${
      typeExpression(node.additionalProperties, model, next).text})`);
  }
  return atom(esc(metadata.type ?? 'not specified'));
}

/**
 * Shallow type presentation; named references always use canonical destinations.
 * An array's items use their plain type (`string[]`), never their enum; item constraints
 * are listed with the array or its item section instead. See `typeExpression()`.
 * @param {string} source Normalized schema source
 * @param {object} model Normalized document
 * @returns {string} Escaped type presentation
 */
const typeLabel = (source, model) => (source ? typeExpression(source, model).text : '');

function schemaDescription(source, model, seen = new Set()) {
  if (!source || seen.has(source)) return '';
  const node = model.nodes[source];
  if (node.metadata?.description !== undefined) return node.metadata.description;
  return node.reference
    ? schemaDescription(node.reference.schema, model, new Set([...seen, source])) : '';
}

/**
 * Render a `table` block: a real table whose first row is the column header row.
 * Section-level tables are found by `decorateBlocks()`. Tables nested in responses, schemas,
 * or disclosures are not, so they are emitted already marked as blocks for `loadSection()`.
 * A `{ rowHeader, labelledBy }` cell becomes a row header named by the element with that ID.
 */
function tableBlock(rows, className = '', nested = false) {
  const cell = (c) => (typeof c === 'object'
    ? `<th scope="row" aria-labelledby="${attr(c.labelledBy)}">${c.rowHeader}</th>`
    : `<td>${c}</td>`);
  const tr = (r) => `      <tr>${r.map(cell).join('')}</tr>`;
  const body = rows.map(tr).join('\n');
  const block = nested ? ' block" data-block-name="table' : '';
  return `<div class="table${className ? ` ${className}` : ''}${block}">\n    <table>\n${body}\n    </table>\n  </div>`;
}

const jsonValue = (value) => `<code>${esc(JSON.stringify(value))}</code>`;
const fragmentLink = (id) => `#${encodeURIComponent(id)}`;

/**
 * Render one metadata pair with an escaped label and pre-escaped value.
 * @param {string} label Property label
 * @param {string} value Safe HTML value
 * @param {boolean} required Optional contextual requiredness
 * @param {string} className Optional class for both the term and the value
 * @param {string} id Optional fragment target for the pair
 * @returns {string} Grouped semantic term and value
 */
function metadataEntry(label, value, required = undefined, className = '', id = '') {
  const state = required === undefined ? '' : ` data-required="${required}"`;
  const target = id ? ` id="${attr(id)}"` : '';
  const attribute = className ? ` class="${attr(className)}"` : '';
  return `<div${target}${state}><dt${attribute}>${esc(label)}</dt><dd${attribute}>${value}</dd></div>`;
}

/**
 * Group schema metadata by placement. `identity` holds what qualifies the name: type,
 * contextual requiredness, deprecation and format. `facets` holds annotations and
 * behavioral constraints such as allowed values, defaults and limits.
 * @param {object} metadata Authored schema annotations and constraints
 * @param {object} options Presentation options
 * @param {string} options.type Optional pre-escaped type presentation
 * @param {boolean} options.required Optional normalized contextual requiredness
 * @param {string} options.requiredLabel Label preserving the requiredness context
 * @param {string[]} options.constraints Additional safe metadata entries for this scope
 * @param {boolean} options.enumInType Whether the type presentation already lists the enum
 * @param {string} options.typeId Optional fragment target for the Type entry
 * @param {boolean} options.item Whether these are an array item's constraints, listed with
 *   the array; labels then name the item (`Allowed item values`, `Item pattern`)
 * @returns {{identity: string[], facets: string[]}} Grouped semantic terms and values
 */
function metadataParts(metadata = {}, {
  type: schemaType, required: fieldRequired, requiredLabel = 'Required', constraints = [],
  enumInType = false, typeId = '', item = false,
} = {}) {
  const identity = [];
  const facets = [];
  const scoped = (name) => {
    if (!item) return name;
    return name === 'Allowed values'
      ? 'Allowed item values' : `Item ${name[0].toLowerCase()}${name.slice(1)}`;
  };
  const add = (entries, name, value, className = '') => {
    entries.push(metadataEntry(scoped(name), value, undefined, className));
  };
  if (schemaType !== undefined) {
    identity.push(metadataEntry('Type', `<code>${schemaType}</code>`, undefined, '', typeId));
  }
  if (fieldRequired !== undefined) {
    identity.push(metadataEntry(requiredLabel, fieldRequired ? 'yes' : 'no', fieldRequired));
  }
  if (metadata.deprecated === true) add(identity, 'Deprecated', 'yes', 'deprecated');
  if (Object.hasOwn(metadata, 'format')) add(identity, 'Format', `<code>${esc(metadata.format)}</code>`);
  if (metadata.title) add(facets, 'Title', esc(metadata.title));
  if (metadata.enum && !enumInType) add(facets, 'Allowed values', metadata.enum.map(jsonValue).join(', '));
  if (Object.hasOwn(metadata, 'default')) add(facets, 'Default', jsonValue(metadata.default));
  if (Object.hasOwn(metadata, 'const')) add(facets, 'Constant', jsonValue(metadata.const));
  if (metadata.required?.length) {
    add(facets, 'Required properties in this object', metadata.required.map(jsonValue).join(', '));
  }
  [
    ['pattern', 'Pattern'],
    ['minimum', 'Minimum'], ['maximum', 'Maximum'],
    ['exclusiveMinimum', 'Exclusive minimum'], ['exclusiveMaximum', 'Exclusive maximum'],
    ['minLength', 'Minimum length'], ['maxLength', 'Maximum length'],
    ['minItems', 'Minimum items'], ['maxItems', 'Maximum items'],
    ['minProperties', 'Minimum properties'], ['maxProperties', 'Maximum properties'],
    ['multipleOf', 'Multiple of'], ['uniqueItems', 'Unique items'],
    ['readOnly', 'Read only'], ['writeOnly', 'Write only'], ['nullable', 'Nullable (declared)'],
  ].forEach(([key, label]) => {
    if (Object.hasOwn(metadata, key)) {
      add(facets, label, key === 'pattern'
        ? `<code>${esc(metadata[key])}</code>` : jsonValue(metadata[key]));
    }
  });
  Object.entries(metadata.dependentRequired ?? {}).forEach(([name, required]) => {
    add(facets, 'Dependent requirement', `When ${jsonValue(name)} is present, also require ${
      required.map(jsonValue).join(', ')}`);
  });
  facets.push(...constraints);
  return { identity, facets };
}

const metadataList = (entries) => (entries.length ? `<dl class="metadata">${entries.join('')}</dl>` : '');

/**
 * Render schema type, contextual requiredness and facets as one semantic metadata list,
 * for scopes shown in a single column. Arguments match `metadataParts()`.
 * @returns {string} Definition list of grouped properties
 */
function schemaMetadata(...args) {
  const { identity, facets } = metadataParts(...args);
  return metadataList([...identity, ...facets]);
}

const disclosure = (label, content, explanation, className = '') => `<details class="children${
  className ? ` ${className}` : ''}"><summary>${
  explanation ? `${esc(label)}: <span class="composition-explanation">${
    esc(explanation)}</span>` : esc(label)}</summary>${content}</details>`;

/**
 * Render authored examples for the description flow. A single undescribed scalar example
 * is a metadata entry, for the caller to place in its own metadata list; several,
 * structured or described examples are disclosed. Values keep their authored JSON types.
 * @param {object[]} items Examples as `{ value, label?, description? }`
 * @param {object} model Normalized document, for description links
 * @returns {{entries: string[], disclosure: string}} Inline entries or disclosure markup;
 *   both are empty when there are no examples
 */
function renderExamples(items, model) {
  if (!items.length) return { entries: [], disclosure: '' };
  const [first] = items;
  if (items.length === 1 && (first.value === null || typeof first.value !== 'object')
    && !mdProse(first.description, model)) {
    return {
      entries: [metadataEntry(
        `Example${first.label ? ` (${first.label})` : ''}`,
        jsonValue(first.value),
      )],
      disclosure: '',
    };
  }
  return {
    entries: [],
    disclosure: disclosure(
      `Examples (${items.length})`,
      items.map(({ value, label, description }) => `<p>${label ? `${esc(label)}: ` : ''}${
        jsonValue(value)}</p>${mdProse(description, model)}`).join(''),
      undefined,
      'examples',
    ),
  };
}

/**
 * Render authored schema examples (`example`, then `examples[]`), which are unnamed.
 * @param {object} metadata Authored schema annotations
 * @param {object} model Normalized document
 * @returns {{entries: string[], disclosure: string}} See `renderExamples()`
 */
function schemaExamples(metadata = {}, model = undefined) {
  return renderExamples([
    ...(Object.hasOwn(metadata, 'example') ? [metadata.example] : []),
    ...(metadata.examples ?? []),
  ].map((value) => ({ value })), model);
}

/**
 * Render normalized OpenAPI examples (parameter, header or media type), labeling named
 * examples by summary, else name.
 * @param {object[]} examples Normalized examples
 * @param {object} model Normalized document, for description links
 * @returns {{entries: string[], disclosure: string}} See `renderExamples()`
 */
const openApiExamples = (examples, model) => renderExamples(examples.map((example) => ({
  value: example.value,
  label: example.summary ?? example.name,
  description: example.description,
})), model);

/** Field targets are local to one representation; a path repeated by `allOf` keeps one target. */
function fieldTarget(state, parts) {
  const id = fieldAnchor(state.context, parts);
  const repeated = state.targets.has(id);
  state.targets.add(id);
  return { id, attribute: repeated ? '' : ` id="${attr(id)}"` };
}

function referenceSource(node, model) {
  return node.reference.component
    ? model.schemaNames[node.reference.name].source : node.reference.schema;
}

function structuredSchema(node) {
  return node && (node.reference || node.items || node.additionalProperties
    || node.properties?.length || node.patternProperties?.length
    || node.allOf?.length || node.oneOf?.length || node.anyOf?.length || node.not);
}

/**
 * Whether a schema node is a bare reference, with no keyword beside its `$ref`.
 * @param {object} node Normalized schema node
 * @returns {boolean} True for `{ "$ref": … }` alone
 */
function referenceOnly(node) {
  return !!node.reference && !Object.keys(node.metadata).length
    && ['properties', 'patternProperties', 'definitions', '$defs', 'allOf', 'oneOf', 'anyOf']
      .every((keyword) => !node[keyword].length)
    && !node.items && !node.additionalProperties && !node.not;
}

/**
 * Whether an array's item schema is fully expressed by its array: a scalar with no
 * structure or reference, and no description, title, examples or deprecation of its own.
 * Its type completes the array type and its constraints are listed with the array.
 * @param {object} item Normalized item schema node
 * @returns {boolean} True when an item section would add nothing
 */
const inlineItem = (item) => item.boolean === undefined && !structuredSchema(item)
  && ['description', 'title', 'example', 'examples', 'deprecated']
    .every((key) => item.metadata[key] === undefined);

/**
 * Render a schema scope, or its two cells when used as a top-level property row.
 * @param {string} source Normalized schema source
 * @param {object} model Normalized document and schema destinations
 * @param {object} state Representation-local anchor state
 * @param {object} options Traversal, identity and direct-property presentation options
 * @returns {string|string[]} Schema markup or identity/content cells for a property row
 */
function schemaFields(source, model, state, options) {
  if (!source) return '';
  const node = model.nodes[source];
  const constraints = [];
  if (options.identity && options.identity.pattern !== undefined) {
    constraints.push(metadataEntry('Property name pattern', `<code>${esc(options.identity.pattern)}</code>`));
  }
  if (node.reference && node.metadata.type) {
    constraints.push(metadataEntry(
      'Type constraint at this reference',
      `<code>${esc([node.metadata.type].flat().join(' | '))}</code>`,
    ));
  }
  if (node.additionalProperties && model.nodes[node.additionalProperties].boolean === false) {
    constraints.push(metadataEntry('Additional properties', 'not allowed'));
  }
  // An inline item's constraints join the array's list, and its fragment target moves to
  // the array's Type entry, so no separate item section is rendered.
  const item = node.items && !options.seen.has(source) ? model.nodes[node.items] : undefined;
  const foldItem = Boolean(item && inlineItem(item));
  const itemTarget = foldItem && options.anchors
    ? fieldTarget(state, [...options.parts, { item: true }])
    : { id: '', attribute: '' };
  if (foldItem) {
    const itemParts = metadataParts(item.metadata, { item: true });
    constraints.push(...itemParts.identity, ...itemParts.facets);
  }
  const grouped = metadataParts(options.seen.has(source) ? undefined : node.metadata, {
    type: typeLabel(source, model),
    required: options.identity ? options.identity.required : undefined,
    requiredLabel: 'Required in this object',
    constraints,
    enumInType: enumAsType(node),
    typeId: itemTarget.attribute ? itemTarget.id : '',
  });
  const tableRow = options.identity && options.identity.table;
  // A scope's examples may be supplied by its owner (media-level examples replace the
  // root schema's); otherwise they are the schema's own.
  let ownExamples = options.examples;
  if (!ownExamples) {
    ownExamples = options.seen.has(source) || options.omitExamples
      ? renderExamples([]) : schemaExamples(node.metadata);
  }
  // Property rows keep identity metadata beside the name and facets in the description.
  // Facets and an inline example share one list; a disclosure follows it.
  const flow = [...grouped.facets, ...ownExamples.entries];
  const content = options.identity && !tableRow ? [options.identity.name] : [];
  if (!options.seen.has(source) && node.boolean === undefined) {
    content.push(mdProse(node.metadata.description, model));
  }
  // Entries supplied by the scope's owner (a response's media type) lead its single list.
  content.push(metadataList(tableRow
    ? flow : [...(options.leading ?? []), ...grouped.identity, ...flow]));
  if (ownExamples.disclosure) content.push(ownExamples.disclosure);
  const identityCell = tableRow && {
    rowHeader: `<div class="identity">${options.identity.name}${metadataList(grouped.identity)}</div>`,
    labelledBy: options.identity.id,
  };
  const render = () => (tableRow ? [identityCell, content.join('\n')] : content.join('\n'));
  if (options.seen.has(source)) {
    const href = node.reference?.url ?? `${state.pageUrl}${fragmentLink(options.seen.get(source))}`;
    content.push(`<p>Recursive schema: <a href="${attr(href)}">See schema definition</a>.</p>`);
    return render();
  }
  if (node.boolean !== undefined) return render();
  const next = {
    ...options,
    identity: undefined,
    propertyTable: false,
    omitExamples: false,
    leading: [],
    examples: undefined,
    seen: new Map([...options.seen, [source, options.target]]),
  };
  if (node.reference) {
    const target = referenceSource(node, model);
    const referred = model.nodes[target];
    if (node.reference.url && !node.reference.component) {
      content.push(`<dl class="metadata">${metadataEntry(
        'Containing schema',
        `<a href="${attr(node.reference.url)}">${esc(node.reference.name)}</a>`,
      )}</dl>`);
    }
    if (next.seen.has(target)) {
      const href = node.reference.url ?? `${state.pageUrl}${fragmentLink(next.seen.get(target))}`;
      content.push(`<p>Recursive reference: <a href="${attr(href)}">See schema definition</a>.</p>`);
    } else if (!node.reference.component || options.previewReference) {
      content.push(disclosure(
        node.reference.component
          ? `Properties of ${node.reference.name}` : 'Referenced structure',
        schemaFields(target, model, state, {
          ...next, previewReference: false, propertyTable: options.propertyTable,
        }),
      ));
    } else {
      const description = node.metadata.description === undefined
        ? mdProse(schemaDescription(target, model), model) : '';
      const facets = schemaMetadata(referred.metadata);
      const examples = schemaExamples(referred.metadata);
      if (description || facets || examples.entries.length || examples.disclosure) {
        const inherited = metadataParts(referred.metadata, {
          type: typeLabel(target, model), enumInType: enumAsType(referred),
        });
        content.push(`<section class="reference-metadata"><p>From referenced definition:</p>${
          description}${metadataList([...inherited.identity, ...inherited.facets, ...examples.entries])}${
          examples.disclosure}</section>`);
      }
    }
  }
  const renderField = (edge, part, required) => {
    const parts = [...options.parts, part];
    const target = options.anchors
      ? fieldTarget(state, parts)
      : { id: options.target, attribute: '' };
    const name = fieldPath(parts);
    const table = options.propertyTable && part.property !== undefined;
    const field = schemaFields(edge.schema, model, state, {
      ...next,
      parts,
      target: target.id,
      previewReference: false,
      identity: {
        name: `<div class="field-name"${target.attribute}><a${table ? ' class="name"' : ''} href="${attr(fragmentLink(target.id))}"><code>${
          esc(name)}</code></a></div>`,
        id: target.id,
        required,
        pattern: part.pattern,
        table,
      },
    });
    return table ? field : `<section class="field">${field}</section>`;
  };
  const children = node.properties.map((edge) => (
    renderField(edge, { property: edge.name }, edge.required)
  ));
  if (children.length) {
    const fields = options.propertyTable
      ? tableBlock([['Property', 'Description'], ...children], 'fields', true)
      : `<section>${children.join('\n')}</section>`;
    content.push(options.parts.length ? disclosure(`Child properties (${children.length})`, fields)
      : fields);
  }
  if (node.items && !foldItem) {
    const items = renderField({ schema: node.items }, { item: true }, undefined);
    const plainReference = item.reference?.component && referenceOnly(item)
      && !next.seen.has(referenceSource(item, model));
    content.push(!structuredSchema(item) || plainReference
      ? `<section class="children"><p>Array items</p>${items}</section>`
      : disclosure('Array items', items));
  }
  if (node.additionalProperties && model.nodes[node.additionalProperties].boolean !== false) {
    const value = model.nodes[node.additionalProperties];
    const values = renderField(
      { schema: node.additionalProperties },
      { dictionary: true },
      undefined,
    );
    content.push(!structuredSchema(value)
      ? `<section class="children"><p>Dictionary values</p>${values}</section>`
      : disclosure('Dictionary values', values));
  }
  node.patternProperties.forEach((edge) => {
    content.push(disclosure(
      `Values matching ${edge.name}`,
      renderField(edge, { pattern: edge.name }, undefined),
    ));
  });
  [
    ['allOf', 'All of', 'Every contribution must apply.', 'Contribution'],
    ['oneOf', 'One of', 'Exactly one alternative must apply.', 'Option'],
    ['anyOf', 'Any of', 'At least one alternative must apply.', 'Option'],
  ].forEach(([keyword, label, explanation, member]) => {
    if (!node[keyword].length) return;
    const alternatives = node[keyword].map((part, index) => (
      `<section class="composition"><p>${member} ${index + 1}</p>${
        schemaFields(part, model, state, {
          ...next,
          anchors: options.anchors && keyword === 'allOf',
          previewReference: false,
        })}</section>`
    )).join('\n');
    content.push(disclosure(label, alternatives, explanation));
  });
  if (node.not) {
    content.push(disclosure('Must not match this schema', schemaFields(node.not, model, state, {
      ...next, anchors: false, previewReference: false,
    })));
  }
  return render();
}

/**
 * Render a schema in its section. `leading` metadata entries and replacement `examples`
 * belong to the root scope: they describe the same entity as the root schema, so they
 * join its single metadata list.
 */
function schemaTable(source, model, {
  context = 'field', pageUrl, target = 'schema', previewReference = false, propertyTable = false,
  omitExamples = false, leading = [], examples = undefined,
} = {}) {
  const state = { context, pageUrl, targets: new Set() };
  return `<section class="schema">${schemaFields(source, model, state, {
    parts: [],
    seen: new Map(),
    target,
    anchors: true,
    previewReference,
    propertyTable,
    omitExamples,
    leading,
    examples,
  })}</section>`;
}

/**
 * Render media type sections. Body examples are linked to the code rail (`examples`);
 * parameter/header media examples render inline instead (`inlineExamples`) and replace
 * the media schema's own root examples. `omitExamples` suppresses both, for when the
 * parameter's direct examples take precedence. A media type and its root schema describe
 * one representation, so for request bodies, responses and `content` parameters alike the
 * media type, its anchor and any inline examples join the root schema's metadata list.
 */
function contentBody(media, model, {
  pageUrl, examples = false, propertyTable = false,
  inlineExamples = false, omitExamples = false,
} = {}) {
  return media.map((entry) => {
    const leading = [
      metadataEntry('Media type', `<code>${esc(entry.mediaType)}</code>`, undefined, '', entry.context),
    ];
    const inline = inlineExamples && !omitExamples && entry.examples.length
      ? openApiExamples(entry.examples, model) : undefined;
    const label = `View ${entry.mediaType} examples`;
    const link = examples && entry.examples.length ? `<p class="example-link button-wrapper"><a class="button secondary" href="#${
      attr(entry.context)}-examples" title="${attr(label)}">${esc(label)}</a></p>\n` : '';
    // Without a schema there is no root scope to join; the representation's own list stands.
    const representation = entry.schema
      ? schemaTable(entry.schema, model, {
        context: entry.context,
        target: entry.context,
        pageUrl,
        previewReference: true,
        propertyTable,
        omitExamples,
        leading,
        examples: inline,
      })
      : `${metadataList([...leading, ...(inline?.entries ?? [])])}${inline?.disclosure ?? ''}`;
    return `${link}${representation}`;
  }).join('\n');
}

function securityContent(security) {
  if (!security.declared) return '';
  const alternatives = security.alternatives.map((requirement) => {
    const schemes = requirement.schemes.map(({ name, scopes, scheme: definition }) => {
      const scheme = definition.value;
      const entries = [];
      if (scheme.type === 'apiKey') {
        entries.push(
          metadataEntry('Location', esc(scheme.in)),
          metadataEntry('Credential name', `<code>${esc(scheme.name)}</code>`),
        );
      } else if (scheme.scheme) {
        entries.push(metadataEntry('Scheme', esc(scheme.scheme)));
      }
      if (scopes.length) {
        entries.push(metadataEntry(
          ['oauth2', 'openIdConnect'].includes(scheme.type) ? 'scopes' : 'permissions',
          scopes.map((scope) => `<code>${esc(scope)}</code>`).join(', '),
        ));
      }
      return `<div><code class="name">${esc(name)}</code>${
        entries.length ? `<dl class="metadata">${entries.join('\n')}</dl>` : ''}</div>`;
    });
    return `<li>${schemes.join(' <span class="and">AND</span> ') || 'No authentication required'}</li>`;
  });
  return `<section class="auth"><h2>Authentication</h2>\n${
    alternatives.length > 1 ? '<p class="intro">One of the following:</p>\n' : ''
  }${alternatives.length ? `<ul class="alternatives">${alternatives.join('\n')}</ul>` : '<p class="intro">No authentication required</p>'}</section>`;
}

/**
 * Indent every line of an HTML fragment by `pad`, except the content lines of a `<pre>`,
 * which render verbatim.
 */
function indentBody(str, pad) {
  let inPre = false;
  return str.split('\n').map((line) => {
    const out = inPre ? line : `${pad}${line}`;
    const opens = (line.match(/<pre[\s>]/g) || []).length;
    const closes = (line.match(/<\/pre>/g) || []).length;
    if (opens > closes) inPre = true;
    else if (closes > opens) inPre = false;
    return out;
  }).join('\n');
}

/**
 * Render one example panel. The header shows the operation's method badge, the example
 * name (linked to its documented representation), the response status badge, and the
 * media type on its own line; the expanded view reuses this header.
 * @param {string} method Lowercase HTTP method of the operation
 * @param {string} name Example name, e.g. `Request` or `Response: success`
 * @param {*} example Example value
 * @param {string|number|undefined} status Response status, or undefined for requests
 * @param {string} mediaType Example media type
 * @param {string} context Anchor ID of the documented representation
 * @param {boolean} first Whether this is the first example for the representation
 * @param {string} section Key of the content section the example belongs to
 * @returns {string} The code-sample block
 */
function codePanel(method, name, example, status, mediaType, context, first, section) {
  const language = mediaType === 'text/yaml' ? 'yaml' : 'json';
  const text = esc(language === 'yaml'
    ? String(example) : JSON.stringify(example, null, 2));
  const badge = `<span class="http-method http-${attr(method)}">${esc(method.toUpperCase())}</span>`;
  const statusBadge = status === undefined
    ? '' : ` <span class="code-status status-${String(status)[0]}xx">${esc(String(status))}</span>`;
  const label = `${method.toUpperCase()} ${name}${status === undefined ? '' : ` ${status}`} (${mediaType})`;
  return `<div class="code-sample" data-examples="${attr(section)}">
    <div class="head"><span class="title">${badge} <a href="#${attr(context)}"><span class="name">${esc(name)}</span></a>${statusBadge} <span class="media">(${esc(mediaType)})</span></span></div>
    <pre${first ? ` id="${attr(context)}-examples"` : ''} role="region" aria-label="${attr(label)}" tabindex="0"><code class="language-${language}">${text}</code></pre>
  </div>`;
}

/**
 * Render the rail panels for one content section's examples. Each panel and its
 * description carry the section's key, matching the `data-examples` boundary in the
 * main content. The description is an unclassed div so it stays content, not a block.
 * @param {string} method Lowercase HTTP method of the operation
 * @param {object[]} media Normalized media entries with examples
 * @param {string} title `Request` or `Response`
 * @param {string|number|undefined} status Response status, or undefined for requests
 * @param {object} model Normalized document
 * @param {string} section Key of the content section the examples belong to
 * @returns {string[]} The panels
 */
function examplePanels(method, media, title, status, model, section) {
  const panels = [];
  media.forEach((entry) => {
    entry.examples.forEach((example, index) => {
      const name = example.name === undefined ? title : `${title}: ${example.summary ?? example.name}`;
      const { mediaType, context } = entry;
      const description = mdProse(example.description, model);
      panels.push((description ? `<div data-examples="${attr(section)}">${description}</div>` : '')
        + codePanel(method, name, example.value, status, mediaType, context, index === 0, section));
    });
  });
  return panels;
}

function parameterContent(parameter, model, pageUrl) {
  const content = [mdProse(parameter.description, model)];
  const node = model.nodes[parameter.schema];
  // A simple schema's own description follows the parameter's, before its facets.
  if (node && !structuredSchema(node) && node.metadata
    && node.metadata.description !== parameter.description) {
    content.push(mdProse(node.metadata.description, model));
  }
  // Direct examples override those of the immediate schema or media types (OpenAPI 3.1).
  // The parameter's own schema examples stay outside the schema disclosure, shown once.
  const direct = parameter.examples.length > 0;
  let examples = renderExamples([]);
  if (direct) examples = openApiExamples(parameter.examples, model);
  else if (node) examples = schemaExamples(node.metadata, model);
  // Behavioral facets of the parameter's schema and an inline example share one list;
  // identity shows the rest.
  const facets = metadataList([
    ...(parameter.deprecated
      ? [metadataEntry('Parameter deprecated', 'yes', undefined, 'deprecated')] : []),
    ...(node
      ? metadataParts(node.metadata, { enumInType: enumAsType(node) }).facets
      : []),
    ...examples.entries,
  ]);
  if (facets) content.push(facets);
  if (examples.disclosure) content.push(examples.disclosure);
  if (node) {
    if (structuredSchema(node)) {
      content.push(disclosure('Schema and constraints', `${
        schemaTable(parameter.schema, model, {
          context: parameter.context, target: parameter.context, pageUrl, omitExamples: true,
        })}`));
    }
  }
  content.push(contentBody(parameter.media, model, {
    pageUrl, inlineExamples: true, omitExamples: direct,
  }));
  return content.join('\n');
}

/**
 * Render a parameter or response header's name and compact local schema metadata.
 * @param {object} parameter Normalized parameter or response header
 * @param {object} model Normalized document with schema nodes and destinations
 * @returns {string} Identity column content with its fragment target
 */
function parameterIdentity(parameter, model) {
  const node = model.nodes[parameter.schema];
  return `<div class="identity"><a class="name" href="${attr(fragmentLink(parameter.context))}"><code id="${
    attr(parameter.context)}">${esc(parameter.name)}</code></a>${
    metadataList(metadataParts(node ? node.metadata : undefined, {
      type: parameter.schema ? typeLabel(parameter.schema, model) : undefined,
      required: parameter.required,
    }).identity)}</div>`;
}

function paramsTable(params, where, model, pageUrl) {
  const rows = [['Parameter', 'Description']];
  params.filter((x) => x.in === where).forEach((p) => {
    rows.push([
      { rowHeader: parameterIdentity(p, model), labelledBy: p.context },
      parameterContent(p, model, pageUrl),
    ]);
  });
  return rows.length === 1 ? '' : tableBlock(rows, 'fields');
}

/** Header-description table for a response's headers, or '' when none. */
function headersTable(headers, model, pageUrl) {
  if (!headers.length) return '';
  const rows = [['Header', 'Description']];
  headers.forEach((header) => {
    rows.push([
      { rowHeader: parameterIdentity(header, model), labelledBy: header.context },
      parameterContent(header, model, pageUrl),
    ]);
  });
  return tableBlock(rows, 'headers fields', true);
}

/**
 * Render the effective servers as metadata entries, preserving alternate-server labels.
 * @param {object[]} servers Effective OpenAPI servers in source order
 * @returns {string[]} One entry per server, or none when no servers exist
 */
function serverEntries(servers) {
  if (!servers?.length) return [];
  const [primary, ...rest] = servers;
  const line = (label, url) => metadataEntry(label, `<code>${esc(url)}</code>`);
  const lines = [line('Base URL', primary.url)];
  rest.forEach((server) => lines.push(line(server.description ?? 'Alt', server.url)));
  return lines;
}

/**
 * Escape an endpoint path, allowing line breaks after `/` and `?` so long paths wrap.
 * @param {string} p OpenAPI path template
 * @returns {string} Escaped path markup
 */
const endpointPath = (p) => esc(p).replace(/([/?])/g, '$1<wbr>');

/**
 * Render the effective servers as a metadata list.
 * @param {object[]} servers Effective OpenAPI servers in source order
 * @returns {string} Server definition list, or empty text when no servers exist
 */
function baseUrlLine(servers) {
  const lines = serverEntries(servers);
  return lines.length ? `<dl class="metadata servers">${lines.join('\n')}</dl>` : '';
}

/**
 * Render a complete API reference page around its content and optional example panels.
 * @param {string} title Page title, before the API title
 * @param {string} description Authored description for the meta description
 * @param {string} content Content column markup
 * @param {object} model Normalized OpenAPI model
 * @param {string} url Canonical page URL
 * @param {string[]} panels Code rail example panels; none omits the rail
 * @param {string} layout Optional content layout class; without one, a page without
 *   examples uses `no-examples`
 * @returns {string} The page HTML
 */
function renderPage(title, description, content, model, url, panels = [], layout = '') {
  const modifier = layout || (panels.length ? '' : 'no-examples');
  const sections = [
    `<div class="navigation"><p><a href="/widgets/api-nav.html?nav=${attr(model.baseUrl)}/nav.html">API navigation</a></p></div>`,
    `<div class="content${modifier ? ` ${modifier}` : ''}" id="api-main" tabindex="-1">\n${content}\n</div>`,
  ];
  if (panels.length) {
    sections.push(`<div class="code-rail" role="complementary" aria-label="Request and response examples">\n  <h2>Examples</h2>\n  ${panels.join('\n  ')}\n</div>`);
  }

  const body = sections.map((s) => indentBody(s, '      ')).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
${pageHead(`${title} — ${model.info.title}`, plain(description, model), url)}
  <body>
    <a class="skip-link" href="#api-main">Skip to API content</a>
    <header></header>
    <main>
${body}
    </main>
    <footer></footer>
  </body>
</html>
`;
}

/**
 * Render one operation page; the example rail is omitted when it has no examples.
 * @param {object} op Normalized operation
 * @param {object} model Normalized OpenAPI model
 * @returns {string} The page HTML
 */
function renderOperationPage(op, model) {
  const { method, path: p, parameters: params } = op;
  const title = op.summary ?? op.operationId;

  // --- Middle column: prose + tables ------------------------------------
  const content = [];
  content.push(`<p class="eyebrow">${esc(op.tags.map((name) => (
    model.tags.find((tag) => tag.name === name).displayName
  )).join(', '))}</p>`);
  content.push(`<h1 id="operation">${esc(title)}</h1>`);
  // The full URL is what readers copy; the visible path omits the base URL shown below it.
  const server = op.servers.length ? op.servers[0].url.replace(/\/+$/, '') : '';
  content.push(`<p class="endpoint"${server ? ` data-url="${attr(server + p)}"` : ''}>`
    + `<span class="http-method http-${method}">${method.toUpperCase()}</span> `
    + `<code class="http-path">${endpointPath(p)}</code></p>`);
  const baseUrl = baseUrlLine(op.servers);
  if (baseUrl) content.push(baseUrl);
  const descProse = mdProse(op.description, model);
  if (descProse) content.push(descProse);
  if (op.permissions.length) {
    content.push(`<dl class="metadata">${metadataEntry(
      'Required permissions',
      `<code>${esc(op.permissions.join(', '))}</code>`,
    )}</dl>`);
  }

  content.push(securityContent(op.security));
  const pathTable = paramsTable(params, 'path', model, op.url);
  if (pathTable) content.push('<h2>Path parameters</h2>', pathTable);
  const queryTable = paramsTable(params, 'query', model, op.url);
  if (queryTable) content.push('<h2>Query parameters</h2>', queryTable);
  const headerTable = paramsTable(params, 'header', model, op.url);
  if (headerTable) content.push('<h2>Request headers</h2>', headerTable);
  const cookieTable = paramsTable(params, 'cookie', model, op.url);
  if (cookieTable) content.push('<h2>Cookie parameters</h2>', cookieTable);

  const request = op.requestBody;
  if (request) {
    content.push(
      '<h2 id="request-body" data-examples="request-body">Request body</h2>',
      `<dl class="metadata">${metadataEntry(
        'Request body required',
        request.required ? 'yes' : 'no',
        request.required,
      )}</dl>`,
      mdProse(request.description, model),
      contentBody(request.media, model, {
        pageUrl: op.url, examples: true, propertyTable: true,
      }),
    );
  }

  const { responses } = op;
  if (responses.length) {
    // Each `data-examples` boundary starts the content section that the rail's examples
    // with the same key belong to. The first status's section starts at the Response heading.
    content.push(`<h2 data-examples="${attr(responses[0].context)}">Response</h2>`);
    responses.forEach((r, index) => {
      const { status } = r;
      const statusClass = `status-${String(status)[0]}xx`;
      const boundary = index ? ` data-examples="${attr(r.context)}"` : '';
      content.push(
        '<section class="response">',
        `<h3 class="heading" id="${attr(r.context)}"${boundary}><span class="status-badge ${attr(statusClass)}">${esc(status)}</span></h3>`,
      );
      const description = mdProse(r.description, model);
      if (description) {
        content.push(`<div class="description">${description}</div>`);
      }
      const ht = headersTable(r.headers, model, op.url);
      if (ht) content.push(ht);
      const t = contentBody(r.media, model, {
        pageUrl: op.url, examples: true, propertyTable: true,
      });
      if (t) content.push(t);
      content.push('</section>');
    });
  }

  // --- Right rail: request + response examples --------------------------
  const panels = [];
  panels.push(...examplePanels(method, request?.media ?? [], 'Request', undefined, model, 'request-body'));
  responses.forEach((r) => {
    panels.push(...examplePanels(method, r.media, 'Response', r.status, model, r.context));
  });

  return renderPage(title, op.description ?? op.summary, content.join('\n'), model, op.url, panels);
}

function operationGroups(model) {
  const tags = model.tags.map((tag) => ({
    ...tag, operations: model.operations.filter((op) => op.tags.includes(tag.name)),
  })).filter((tag) => tag.operations.length);
  const assigned = new Set();
  const groups = model.tagGroups.map((group) => {
    const members = group.tags.map((name) => tags.find((tag) => tag.name === name))
      .filter((tag) => tag && !assigned.has(tag.name));
    members.forEach((tag) => assigned.add(tag.name));
    return { name: group.name, anchor: group.anchor, tags: members };
  }).filter((group) => group.tags.length);
  const remaining = tags.filter((tag) => !assigned.has(tag.name));
  const untagged = model.operations.filter((op) => !op.tags.length);
  if (untagged.length) {
    remaining.push({ displayName: 'Other operations', anchor: 'other-operations', operations: untagged });
  }
  if (remaining.length) groups.push({ tags: remaining });
  return groups;
}

const operationLink = (op) => `<a href="${attr(op.url)}">`
  + `<span class="http-method http-${op.method}">${op.method.toUpperCase()}</span>`
  + `<span class="op-summary">${esc(op.summary ?? op.operationId)}</span></a>`;
const schemaLink = (schema) => `<a href="${attr(schema.url)}">${esc(schema.name)}</a>`;
const navGroup = (name, children) => `<li><span class="group">${esc(name)}</span>`
  + `<ul>${children.join('\n')}</ul></li>`;

function renderNav(model) {
  const items = [`<li><a href="${attr(model.baseUrl)}">API overview</a></li>`];
  operationGroups(model).forEach((group) => {
    const tags = group.tags.map((tag) => navGroup(
      tag.displayName,
      tag.operations.map((op) => `<li>${operationLink(op)}</li>`),
    ));
    items.push(group.name ? navGroup(group.name, tags) : tags.join('\n'));
  });
  items.push(navGroup('Schemas', [
    `<li><a href="${attr(model.baseUrl)}/schemas">Schema index</a></li>`,
    ...model.schemas.map((schema) => `<li>${schemaLink(schema)}</li>`),
  ]));
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>API Reference</title></head>
<body>
  <nav>
    <ul>
${items.join('\n')}
    </ul>
  </nav>
</body>
</html>
`;
}

/**
 * Link one operation from the API root in the endpoint box: method, then the summary and,
 * secondary, the path. The space keeps the summary and path apart in the link text.
 * @param {object} op Normalized operation
 * @returns {string} Operation link markup
 */
const endpointLink = (op) => `<a class="endpoint" href="${attr(op.url)}">`
  + `<span class="http-method http-${op.method}">${op.method.toUpperCase()}</span> `
  + '<span class="endpoint-text">'
  + `<span class="op-summary">${esc(op.summary ?? op.operationId)}</span> `
  + `<code class="http-path">${endpointPath(op.path)}</code></span></a>`;

/**
 * Render one API root row: text (a heading and its description) beside its aside.
 * @param {string} text Heading and description markup
 * @param {string} aside Metadata list or operation list markup
 * @returns {string} Row markup
 */
const rootRow = (text, aside) => `<section class="row">\n<div class="row-text">\n${text}\n</div>\n${aside}\n</section>`;

/**
 * Render the API root: the introduction beside the API's overview facts, then one row per
 * operation tag, its description beside links to its operations. Named tag groups head
 * their tags; tags outside a group take the group heading level, as in the navigation.
 * @param {object} model Normalized OpenAPI model
 * @returns {string} The API root page
 */
function renderRoot(model) {
  const { info, operations, schemas } = model;
  const facts = [];
  if (info.version) facts.push(metadataEntry('Version', esc(info.version)));
  facts.push(...serverEntries(model.servers));
  facts.push(metadataEntry('Operations', String(operations.length)));
  facts.push(metadataEntry('Schemas', `<a href="${attr(`${model.baseUrl}/schemas`)}">`
    + `${schemas.length} ${schemas.length === 1 ? 'schema' : 'schemas'}</a>`));
  if (info.license && info.license.name) {
    const href = info.license.url ? descriptionLink(info.license.url, model) : undefined;
    const name = esc(info.license.name);
    facts.push(metadataEntry('License', href ? `<a href="${attr(href)}">${name}</a>` : name));
  }
  const content = [rootRow(
    `<h1 id="api-root">${esc(info.title)}</h1>\n${mdProse(info.description, model)}`,
    `<dl class="metadata aside">${facts.join('\n')}</dl>`,
  )];
  operationGroups(model).forEach((group) => {
    if (group.name) {
      content.push(`<h2 class="tag-group" id="${attr(group.anchor)}">${esc(group.name)}</h2>`);
    }
    const level = group.name ? 3 : 2;
    group.tags.forEach((tag) => {
      content.push(rootRow(
        `<h${level} id="${attr(tag.anchor)}">${esc(tag.displayName)}</h${level}>\n`
          + `${mdProse(tag.description, model)}`,
        '<ul class="operations aside" role="list">'
          + `${tag.operations.map((op) => `<li>${endpointLink(op)}</li>`).join('\n')}</ul>`,
      ));
    });
  });
  return renderPage('API overview', info.description, content.join('\n'), model, model.baseUrl, [], 'overview');
}

function renderSchemaIndex(model) {
  const rows = [['Schema', 'Description']];
  model.schemas.forEach((schema) => {
    rows.push([schemaLink(schema), mdInline(schemaDescription(schema.source, model), model)]);
  });
  return renderPage('Schema index', 'Reusable API schemas', [
    '<h1 id="schema-index">Schema index</h1>',
    `<p>${model.schemas.length} canonical schemas.</p>`,
    tableBlock(rows, 'schema-index'),
  ].join('\n'), model, `${model.baseUrl}/schemas`);
}

function renderSchemaPage(schema, model) {
  const content = [`<h1 id="schema">${esc(schema.name)}</h1>`];
  if (schema.names.length > 1) {
    content.push(`<dl class="metadata">${metadataEntry('Component names', schema.names.map((name) => (
      `<code>${esc(name)}</code>`
    )).join(', '))}</dl><p>These names share this schema page.</p>`);
  }
  content.push(
    schemaTable(schema.source, model, {
      pageUrl: schema.url, previewReference: true, propertyTable: true,
    }),
  );
  return renderPage(
    schema.name,
    schemaDescription(schema.source, model),
    content.join('\n'),
    model,
    schema.url,
  );
}

/** The artifact path of a route, relative to the version's output directory (`docs/{version}`). */
export function artifactPath(url, baseUrl) {
  const relative = url.slice(baseUrl.length + 1);
  return relative ? `${relative}/index.html` : 'index.html';
}

/** Normalize once, then build all output files as a { relativePath: content } map. */
export function renderSite(doc, { version } = {}) {
  const model = normalizeOpenApi(doc, { version });
  const files = { 'nav.html': renderNav(model) };
  const addPage = (url, html) => {
    const name = artifactPath(url, model.baseUrl);
    if (Object.hasOwn(files, name)) throw Error(`Duplicate generated artifact: ${url}`);
    const ids = new Set();
    [...html.matchAll(/<[a-z][^>]*\sid="([^"]*)"[^>]*>/gi)].forEach((match) => {
      if (ids.has(match[1])) throw Error(`Duplicate generated ID ${match[1]} in ${url}`);
      ids.add(match[1]);
    });
    files[name] = html;
  };
  addPage(model.baseUrl, renderRoot(model));
  model.operations.forEach((op) => {
    addPage(op.url, renderOperationPage(op, model));
  });
  addPage(`${model.baseUrl}/schemas`, renderSchemaIndex(model));
  model.schemas.forEach((schema) => {
    addPage(schema.url, renderSchemaPage(schema, model));
  });
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const {
    API_VERSION: version, OPENAPI_SPEC_FILE: specFile, OPENAPI_HTML_DIR: outDir,
  } = process.env;
  if (!version || !specFile || !outDir) {
    process.stderr.write('Set API_VERSION, OPENAPI_SPEC_FILE and OPENAPI_HTML_DIR.\n');
    process.exitCode = 1;
  } else {
    const files = renderSite(JSON.parse(await readFile(specFile, 'utf-8')), { version });
    await Promise.all(Object.entries(files).map(async ([name, content]) => {
      const file = path.join(outDir, name);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content);
      process.stdout.write(`✓ wrote ${path.relative(process.cwd(), file)}\n`);
    }));
  }
}
