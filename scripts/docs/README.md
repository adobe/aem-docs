# API Reference

The API reference for AEM's Admin API and API Service is generated from their bundled OpenAPI
3.1 documents and rendered as static HTML pages that carry `template: api-reference` metadata.
Their version names are `admin` and `api`.

```text
bundled OpenAPI
      │
      ▼
normalizeOpenApi()   normalize-openapi.mjs
      │
      ▼
renderSite()         openapi-to-html.mjs
      │
      ▼
static HTML files
```

| File                        | Role                                                                 |
| --------------------------- | -------------------------------------------------------------------- |
| `normalize-openapi.mjs`     | Validates a bundle and builds the read-only model                    |
| `api-reference-anchors.mjs` | Field-path and anchor grammar, shared by the model and the generator |
| `openapi-to-html.mjs`       | Renders every page from the model; also a CLI                        |
| `preview-api.mjs`           | Local preview server for the generated pages                         |

## Generating

```sh
API_VERSION=api OPENAPI_SPEC_FILE={bundle.json} OPENAPI_HTML_DIR={output directory} \
  node scripts/docs/openapi-to-html.mjs
```

All three variables are required. The output directory corresponds to `/docs/{version}`, so
publishing it at `docs/{version}/` gives the artifact layout below. `renderSite(document,
{ version })` returns the same files as a `{ relativePath: html }` map, relative to that
directory. Output is deterministic and generation fails rather than
emitting a page it cannot render correctly (for example duplicate IDs or artifacts).

**Publishing is unresolved.** Nothing currently runs the generator for publication or delivers
its output to production; how bundles from the API source repositories reach this generator
and how the pages are delivered is still to be designed. Extensionless delivery of detail
routes is part of that work. The frozen bundles in `test/docs/fixtures` are the only inputs
used here.

## Contract: routes and names

| Content         | Route                                   | Artifact                                          |
| --------------- | --------------------------------------- | ------------------------------------------------- |
| API root        | `/docs/{version}`                       | `docs/{version}/index.html`                       |
| Operation       | `/docs/{version}/{operation-slug}`      | `docs/{version}/{operation-slug}/index.html`      |
| Schema index    | `/docs/{version}/schemas`               | `docs/{version}/schemas/index.html`               |
| Schema          | `/docs/{version}/schemas/{schema-slug}` | `docs/{version}/schemas/{schema-slug}/index.html` |
| Navigation list | `/docs/{version}/nav.html`              | `docs/{version}/nav.html`                         |

`{version}` is `admin` (Admin API) or `api` (API Service). Routes other than the navigation
list have no trailing slash or extension, including the API root and schema index; the artifact
layout does not define how they are served. The model's `baseUrl` is the API root route.

- **Slugs:** kebab case with explicit acronym handling (`getHTTPStatus` → `get-http-status`,
  `CDNConfig` → `cdn-config`). Names must be nonempty strings without surrounding whitespace.
- **Operations:** identified by their exact `operationId`. Duplicate IDs, slug collisions
  (`getURL` / `getUrl`) and the reserved slug `schemas` fail. Tags, summaries and order never
  change a route; every operation gets one page, tagged or not.
- **Schema aliases:** a component that is only a `$ref` (optionally with `x-tags`) is an alias.
  Alias chains resolve to one definition with one page. Its name is the single alias with
  nonempty `x-tags` (an AEM convention, not OpenAPI semantics), otherwise the defining
  component's name; several such aliases fail. A `$ref` with constraint siblings is a separate
  schema. Missing targets, alias-only cycles and slug collisions fail.

## Contract: anchors

IDs are page-local and readable. They never depend on declaration order or heading text.

| Target                             | Example                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| Parameter                          | `path-org`, `query-limit`, `header-X-Request-ID` (names keep their spelling)     |
| Request body / representation      | `request-body`, `request-body-application-json`                                  |
| Response / header / representation | `response-200`, `response-200-header-etag`, `response-200-body-application-json` |
| Body field                         | `response-200-body-application-json-items[].sku`                                 |
| Schema page field                  | `field-access.allow[]`                                                           |
| Root tag group / tag               | the tag name in kebab case                                                       |

Field paths are JSONPath-like: `a.b` (nested), `items[]` (array item), `metadata.*`
(dictionary value), `headers[pattern="^x-"]` (pattern dictionary). Names outside
`[A-Za-z_][A-Za-z0-9_-]*` are JSON-quoted, with whitespace escaped: `["a.b"]`, `["items[]"]`,
`["a b"]`. Media labels are kebab case, with `any` for wildcards (`*/*` → `any`,
`application/*` → `application-any`); colliding labels fail.

`allOf` contributions to one field share one target. Anonymous `oneOf`/`anyOf` branches get no
positional IDs; their fields link to the enclosing target. Contexts and paths share the `-`
separator, so a collision across contexts is possible (query parameter `a-b` versus parameter
`a` with property `b`); generation fails on it instead of emitting a duplicate ID.

## Contract: page outline

- **Operation:** H1 title; H2 Authentication, each parameter location, Request body, Response;
  H3 each response status. The example rail has its own H2.
- **Root:** H1 API title; H2 tag group (or ungrouped tag, and "Other operations"); H3 tag.
- **Schema:** H1 only.

Field names are never headings. In field tables, each row starts with
`<th scope="row" aria-labelledby="{field id}">`, so the row header's accessible name is the
field name; its type and requiredness follow inside the same cell. Fields outside tables are
`section.field` elements led by `.field-name`. Headings never skip a level and never
appear in table cells; the tests enforce this for both bundles.

## Model

`normalizeOpenApi(document, { version })` clones its input and returns a read-only model:
`operations`, `schemas` (one per canonical page), `schemaNames` (every component name → its
page), `tags`/`tagGroups` with anchors, `nodes` (the schema graph keyed by JSON pointer) and
`diagnostics` (nonfatal notices, currently only permission strings on non-OAuth schemes).

- Effective parameters (operation over path level, keyed by location and name), servers and
  security (OR alternatives of AND requirements; an empty requirement is anonymous access).
- Requiredness belongs to the property occurrence, not to the referenced definition.
- References keep their own sibling constraints; recursion is a finite graph edge.
- Compositions are never merged: conflicting `allOf` fields and branch-specific requirements
  stay separate.

It fails, with the source pointer, on OpenAPI 3.0, unresolved or external references,
Reference Object siblings, Path Item references, tuple items, conditional and dynamic schema
applicators, and external example values. It does not interpret parameter serialization, media
encodings, discriminators, callbacks, links or server variables, and never synthesizes
examples. `raw` keeps source data for provenance only; rendering uses normalized fields.

## Generated pages

Each page's `<head>` is `head.html` inserted verbatim after `<meta charset>`, followed by the
title, description, `template: api-reference` and canonical link (AEM does not inject
`head.html` into static HTML from the code bus). The body has the skip link, an empty
`<header>` and `<footer>` for the shared blocks, and `main` with three sections: navigation,
documentation (`#api-main`) and, when there are examples, the example rail.

Field tables (`Parameter`/`Header`/`Property | Description`) put the name, Type,
requiredness and Format in the first cell (plus Deprecated for properties), and the
description, remaining constraints, examples and nested structure in the second. Every `dl.metadata` pair is a `div`
holding one `dt` and one `dd`. Reusable schemas are links to their canonical page, not copied
trees; nested inline structures start in closed disclosures.

### Descriptions

All descriptions share one formatter. It supports HTTP(S) Markdown links, bare URLs,
`<autolinks>`, inline code, `*`/`_` emphasis and `**`/`__` strong emphasis, plus links to
`#tag/…/operation/…` and `#schema/…` resolved to their pages. Code and URLs are not
interpreted as emphasis; unsafe or unsupported destinations stay literal text.

Authored HTML is supported in exactly these forms (tag names case-insensitive): `<br>` and
`<br/>`; `<code>text</code>` without nested markup; `<a href="…">label</a>` with a
double-quoted `href` and a plain label. Everything else is escaped. Blank lines, or runs of two
or more `<br>` outside code, start a new paragraph; two trailing spaces or a trailing backslash
make a line break; other newlines are spaces. The meta description is the plain text.

## Local preview

```sh
npm run preview:api
```

This renders both frozen bundles in `test/docs/fixtures` into a temporary directory and serves
them at <http://127.0.0.1:3001/docs/admin> and <http://127.0.0.1:3001/docs/api>, with
scripts, styles, blocks and widgets read from the checkout. It also serves the authored header
and footer fragments from the fixtures, and the browser test pages. Set `API_PREVIEW_PORT` to
use another port; an occupied port fails. A trailing slash on any page route redirects to the
canonical route. Restart to pick up generator or bundle changes; CSS
and JavaScript changes only need a reload. Ctrl+C removes the temporary directory.

`aem up` does not serve these pages: it maps `/docs/api/status` to `status.html`, while the
generator writes `status/index.html`.

## Tests

Generator, model and contract changes need Node tests in `test/docs/` (`npm test`). Update this
document in the same change when a contract changes.
