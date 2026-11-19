import { fieldPath } from './api-reference-anchors.mjs';

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'];
const SCHEMA_MAPS = ['properties', 'patternProperties', 'definitions', '$defs'];
const SCHEMA_LISTS = ['allOf', 'oneOf', 'anyOf'];
const SCHEMA_SINGLE = ['items', 'additionalProperties', 'not'];
const UNSUPPORTED = [
  '$dynamicRef', '$recursiveRef', 'if', 'then', 'else', 'prefixItems', 'contains',
  'unevaluatedProperties', 'unevaluatedItems', 'dependentSchemas', 'dependencies',
  'additionalItems', 'propertyNames',
];
const token = (value) => String(value).replace(/~/g, '~0').replace(/\//g, '~1');
const child = (source, ...parts) => `${source}/${parts.map(token).join('/')}`;
const own = (value, key) => Object.hasOwn(value, key);
const fail = (source, message) => { throw Error(`${source}: ${message}`); };
const kebab = (value) => value.replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
  .replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^a-zA-Z0-9]+/g, '-')
  .toLowerCase()
  .replace(/(^-|-$)/g, '');

function slug(value, source) {
  if (typeof value !== 'string' || !value || value !== value.trim() || !kebab(value)) {
    fail(source, 'Expected a nonempty name without surrounding whitespace and with a usable slug');
  }
  return kebab(value);
}

function object(value, source) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(source, 'Expected an object');
  }
  return value;
}

/**
 * Interprets a bundled OpenAPI document for the API reference.
 * The returned graph uses source JSON pointers as edges, not expanded objects.
 * @param {object} input The bundled OpenAPI document.
 * @param {object} options The version namespace, `admin` or `api`.
 * @returns {object} Operations, grouping, schema graph, schema destinations and diagnostics.
 */
export function normalizeOpenApi(input, { version } = {}) {
  if (!['admin', 'api'].includes(version)) fail('#', 'Expected version admin or api');
  const doc = structuredClone(input);
  object(doc, '#');
  if (!/^3\.1\./.test(doc.openapi ?? '')) fail('#/openapi', 'Expected OpenAPI 3.1');
  const diagnostics = [];
  const nodes = Object.create(null);
  const schemaNames = Object.create(null);
  const schemas = [];
  const baseUrl = `/docs/${version}`;

  function reference(ref, source) {
    if (typeof ref !== 'string' || !ref.startsWith('#/')) {
      fail(source, `Expected a bundled local JSON pointer, received ${ref}`);
    }
    if (/%(?![0-9a-f]{2})/i.test(ref)) fail(source, `Invalid reference encoding: ${ref}`);
    let pointer;
    try {
      pointer = decodeURIComponent(ref.slice(2));
    } catch (error) {
      if (!(error instanceof URIError)) throw error;
      fail(source, `Invalid reference encoding: ${ref}`);
    }
    if (/~(?![01])/.test(pointer)) fail(source, `Invalid JSON pointer: ${ref}`);
    const parts = pointer.split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
    let value = doc;
    parts.forEach((part) => {
      if (value === null || typeof value !== 'object' || !own(value, part)) {
        fail(source, `Unresolved reference: ${ref}`);
      }
      value = value[part];
    });
    return { value, source: child('#', ...parts), parts };
  }

  function resolve(value, source, family, seen = new Set()) {
    object(value, source);
    if (!own(value, '$ref')) return { value, source };
    const target = reference(value.$ref, source);
    if (target.parts[0] !== 'components' || target.parts[1] !== family) {
      fail(source, `Expected a ${family} component reference: ${value.$ref}`);
    }
    if (seen.has(target.source)) fail(source, `Reference-only cycle: ${value.$ref}`);
    seen.add(target.source);
    const siblings = Object.keys(value).filter((key) => key !== '$ref');
    if (siblings.some((key) => !['description', 'summary'].includes(key) && !key.startsWith('x-'))) {
      fail(source, `Unsupported Reference Object siblings: ${siblings.join(', ')}`);
    }
    const resolved = resolve(target.value, target.source, family, seen);
    return {
      source: resolved.source,
      value: { ...resolved.value, ...Object.fromEntries(siblings.map((key) => [key, value[key]])) },
    };
  }

  // x-tags selects public alias names only by the observed AEM authoring convention.
  const definitions = doc.components?.schemas ?? {};
  const alias = (schema) => schema && typeof schema === 'object' && own(schema, '$ref')
    && Object.keys(schema).every((key) => ['$ref', 'x-tags'].includes(key));
  const groups = new Map();
  Object.entries(definitions).forEach(([name, schema]) => {
    const source = child('#', 'components', 'schemas', name);
    slug(name, source);
    let target = { value: schema, source };
    const seen = new Set();
    while (alias(target.value)) {
      if (seen.has(target.source)) fail(source, 'Schema alias-only cycle');
      seen.add(target.source);
      target = reference(target.value.$ref, target.source);
      if (target.parts.length !== 3 || target.parts[0] !== 'components'
        || target.parts[1] !== 'schemas') fail(source, 'Expected a schema-component alias');
    }
    const members = groups.get(target.source) ?? [];
    members.push(name);
    groups.set(target.source, members);
  });
  const schemaSlugs = new Set();
  groups.forEach((members, source) => {
    const publicAliases = members.filter((name) => {
      const schema = definitions[name];
      return alias(schema) && Array.isArray(schema['x-tags']) && schema['x-tags'].length;
    });
    if (publicAliases.length > 1) fail(source, `Ambiguous AEM public aliases: ${publicAliases.join(', ')}`);
    const canonicalName = publicAliases[0]
      ?? members.find((name) => child('#', 'components', 'schemas', name) === source);
    const nameSlug = slug(canonicalName, source);
    if (schemaSlugs.has(nameSlug)) fail(source, `Schema slug collision: ${nameSlug}`);
    schemaSlugs.add(nameSlug);
    const entry = {
      name: canonicalName,
      source,
      url: `${baseUrl}/schemas/${nameSlug}`,
      names: members,
      tags: definitions[canonicalName]?.['x-tags'] ?? [],
    };
    schemas.push(entry);
    members.forEach((name) => { schemaNames[name] = entry; });
  });

  function schemaNode(value, source) {
    if (own(nodes, source)) return source;
    if (typeof value !== 'boolean') object(value, source);
    if (typeof value === 'boolean') {
      nodes[source] = { source, boolean: value, raw: value };
      return source;
    }
    UNSUPPORTED.forEach((keyword) => {
      if (own(value, keyword)) fail(child(source, keyword), `Unsupported schema applicator ${keyword}`);
    });
    if (Array.isArray(value.items)) fail(child(source, 'items'), 'Tuple items are not supported');
    const structural = ['$ref', ...SCHEMA_MAPS, ...SCHEMA_LISTS, ...SCHEMA_SINGLE];
    const node = {
      source,
      raw: value,
      metadata: Object.fromEntries(Object.entries(value)
        .filter(([key]) => !structural.includes(key))),
      properties: [],
      patternProperties: [],
      definitions: [],
      $defs: [],
      allOf: [],
      oneOf: [],
      anyOf: [],
    };
    nodes[source] = node;
    if (own(value, '$ref')) {
      const target = reference(value.$ref, child(source, '$ref'));
      if (target.parts[0] === 'components' && target.parts[1] !== 'schemas') {
        fail(child(source, '$ref'), `Expected a schema reference: ${value.$ref}`);
      }
      const destination = target.parts[0] === 'components' && target.parts[1] === 'schemas'
        ? schemaNames[target.parts[2]] : undefined;
      node.reference = {
        ref: value.$ref,
        schema: schemaNode(target.value, target.source),
        component: target.parts.length === 3 && target.parts[0] === 'components'
          && target.parts[1] === 'schemas',
        ...(destination ? { name: destination.name, url: destination.url } : {}),
      };
    }
    if (own(value, 'required') && (!Array.isArray(value.required)
      || value.required.some((name) => typeof name !== 'string'))) {
      fail(child(source, 'required'), 'Expected property names');
    }
    SCHEMA_MAPS.forEach((keyword) => {
      const entries = Object.entries(object(value[keyword] ?? {}, child(source, keyword)));
      entries.forEach(([name, nested]) => {
        const edge = {
          name, schema: schemaNode(nested, child(source, keyword, name)),
        };
        if (keyword === 'properties') edge.required = (value.required ?? []).includes(name);
        node[keyword].push(edge);
      });
    });
    SCHEMA_LISTS.forEach((keyword) => {
      if (own(value, keyword) && !Array.isArray(value[keyword])) {
        fail(child(source, keyword), 'Expected schema alternatives');
      }
      node[keyword] = (value[keyword] ?? []).map((nested, index) => (
        schemaNode(nested, child(source, keyword, index))
      ));
    });
    SCHEMA_SINGLE.forEach((keyword) => {
      if (own(value, keyword)) node[keyword] = schemaNode(value[keyword], child(source, keyword));
    });
    return source;
  }
  Object.entries(definitions).forEach(([name, schema]) => (
    schemaNode(schema, child('#', 'components', 'schemas', name))
  ));

  function examples(value, source) {
    const result = [];
    if (own(value, 'example')) {
      result.push({ source: child(source, 'example'), value: value.example });
    }
    Object.entries(value.examples ?? {}).forEach(([name, example]) => {
      const at = child(source, 'examples', name);
      const resolved = resolve(example, at, 'examples');
      if (own(resolved.value, 'externalValue')) {
        fail(at, 'External example content is unsupported; supply a bundled value');
      }
      if (!own(resolved.value, 'value')) fail(at, 'Example has no value');
      result.push({
        ...resolved.value, name, source: at, definitionSource: resolved.source,
      });
    });
    return result;
  }

  function media(content, source, context) {
    const slugs = new Set();
    return Object.entries(object(content ?? {}, source)).map(([mediaType, value]) => {
      const at = child(source, mediaType);
      object(value, at);
      const label = mediaType === '*/*' ? 'any' : slug(mediaType.replace(/\*/g, 'any'), at);
      if (slugs.has(label)) fail(at, `Media slug collision: ${label}`);
      slugs.add(label);
      return {
        mediaType,
        source: at,
        context: `${context}-${label}`,
        ...(own(value, 'schema') ? { schema: schemaNode(value.schema, child(at, 'schema')) } : {}),
        examples: examples(value, at),
        raw: value,
      };
    });
  }

  function parameter(value, source, headerName, contextPrefix) {
    const resolved = resolve(value, source, headerName === undefined ? 'parameters' : 'headers');
    const data = resolved.value;
    const name = headerName ?? data.name;
    const location = headerName === undefined ? data.in : 'header';
    if (typeof name !== 'string' || !name
      || !['path', 'query', 'header', 'cookie'].includes(location)) {
      fail(source, 'Expected parameter name and valid location');
    }
    if (location === 'path' && data.required !== true) fail(source, 'Path parameter must be required');
    if (own(data, 'schema') && own(data, 'content')) fail(source, 'Parameter has both schema and content');
    const context = `${contextPrefix ?? location}-${fieldPath([{ property: name }])}`;
    return {
      name,
      in: location,
      source,
      definitionSource: resolved.source,
      required: data.required === true,
      description: data.description,
      deprecated: data.deprecated === true,
      context,
      ...(own(data, 'schema') ? { schema: schemaNode(data.schema, child(resolved.source, 'schema')) } : {}),
      media: media(data.content, child(resolved.source, 'content'), context),
      examples: examples(data, resolved.source),
      raw: data,
    };
  }

  function parameters(values, source) {
    const result = new Map();
    if (values !== undefined && !Array.isArray(values)) fail(source, 'Expected parameters array');
    (values ?? []).forEach((value, index) => {
      const entry = parameter(value, child(source, index));
      const key = JSON.stringify([entry.in, entry.name]);
      if (result.has(key)) fail(entry.source, `Duplicate parameter ${entry.in} ${entry.name}`);
      result.set(key, entry);
    });
    return result;
  }

  const schemes = Object.fromEntries(Object.entries(doc.components?.securitySchemes ?? {})
    .map(([name, value]) => {
      const source = child('#', 'components', 'securitySchemes', name);
      return [name, { name, ...resolve(value, source, 'securitySchemes'), source }];
    }));
  function security(operation, source) {
    const declared = own(operation, 'security') || own(doc, 'security');
    const at = own(operation, 'security') ? child(source, 'security') : '#/security';
    const requirements = own(operation, 'security') ? operation.security : doc.security;
    if (declared && !Array.isArray(requirements)) fail(at, 'Expected security alternatives');
    return {
      declared,
      source: declared ? at : null,
      alternatives: (requirements?.length ? requirements : [{}]).map((requirement, index) => {
        object(requirement, child(at, index));
        const entries = Object.entries(requirement).map(([name, scopes]) => {
          if (!own(schemes, name)) fail(child(at, index), `Unknown security scheme ${name}`);
          if (!Array.isArray(scopes) || scopes.some((scope) => typeof scope !== 'string')) {
            fail(child(at, index, name), 'Expected scope strings');
          }
          if (scopes.length && !['oauth2', 'openIdConnect'].includes(schemes[name].value.type)) {
            diagnostics.push({
              source: child(at, index, name),
              code: 'non-oauth-scopes',
              message: 'Preserved declared permission strings; do not describe them as OAuth scopes',
            });
          }
          return { name, scopes, scheme: schemes[name] };
        });
        return { anonymous: entries.length === 0, schemes: entries };
      }),
    };
  }

  const operations = [];
  const ids = new Set();
  const operationSlugs = new Set();
  Object.entries(doc.paths ?? {}).forEach(([route, item]) => {
    const at = child('#', 'paths', route);
    object(item, at);
    if (own(item, '$ref')) fail(at, 'Bundle Path Item references before normalization');
    const inherited = parameters(item.parameters, child(at, 'parameters'));
    METHODS.forEach((method) => {
      if (!own(item, method)) return;
      const operation = object(item[method], child(at, method));
      const source = child(at, method);
      const nameSlug = slug(operation.operationId, child(source, 'operationId'));
      if (ids.has(operation.operationId)) fail(source, `Duplicate operationId ${operation.operationId}`);
      if (operationSlugs.has(nameSlug) || nameSlug === 'schemas') {
        fail(source, `Operation slug collision or reserved name: ${nameSlug}`);
      }
      ids.add(operation.operationId);
      operationSlugs.add(nameSlug);
      const effective = new Map(inherited);
      parameters(operation.parameters, child(source, 'parameters')).forEach((value, key) => {
        effective.set(key, value);
      });
      const request = operation.requestBody
        ? resolve(operation.requestBody, child(source, 'requestBody'), 'requestBodies') : undefined;
      const responses = Object.entries(operation.responses ?? {}).map(([status, value]) => {
        const responseSource = child(source, 'responses', status);
        const resolved = resolve(value, responseSource, 'responses');
        return {
          status,
          source: responseSource,
          definitionSource: resolved.source,
          description: resolved.value.description,
          context: `response-${status}`,
          headers: Object.entries(resolved.value.headers ?? {}).map(([name, header]) => (
            parameter(
              header,
              child(resolved.source, 'headers', name),
              name,
              `response-${status}-header`,
            )
          )),
          media: media(resolved.value.content, child(resolved.source, 'content'), `response-${status}-body`),
          raw: resolved.value,
        };
      });
      const permissions = operation['x-permissions'] ?? [];
      if (!Array.isArray(permissions) || permissions.some((permission) => typeof permission !== 'string')) {
        fail(child(source, 'x-permissions'), 'Expected permission strings');
      }
      operations.push({
        operationId: operation.operationId,
        method,
        path: route,
        source,
        url: `${baseUrl}/${nameSlug}`,
        summary: operation.summary,
        description: operation.description,
        deprecated: operation.deprecated === true,
        permissions,
        tags: operation.tags ?? [],
        parameters: [...effective.values()],
        security: security(operation, source),
        requestBody: request ? {
          source: child(source, 'requestBody'),
          definitionSource: request.source,
          required: request.value.required === true,
          description: request.value.description,
          context: 'request-body',
          media: media(request.value.content, child(request.source, 'content'), 'request-body'),
          raw: request.value,
        } : null,
        responses,
        servers: operation.servers ?? item.servers ?? doc.servers ?? [],
        raw: operation,
      });
    });
  });
  // a tag or tag group anchor is the fragment target of its heading on the API root
  const tags = (doc.tags ?? []).map((tag, index) => ({
    name: tag.name,
    displayName: tag['x-displayName'] ?? tag.name,
    description: tag.description,
    anchor: slug(tag.name, child('#', 'tags', index, 'name')),
  }));
  operations.forEach((operation) => operation.tags.forEach((name, index) => {
    if (!tags.some((tag) => tag.name === name)) {
      tags.push({ name, displayName: name, anchor: slug(name, child(operation.source, 'tags', index)) });
    }
  }));
  const tagGroups = (doc['x-tagGroups'] ?? []).map((group, index) => ({
    ...group, anchor: slug(group.name, child('#', 'x-tagGroups', index, 'name')),
  }));
  return {
    version,
    baseUrl,
    info: doc.info,
    servers: doc.servers ?? [],
    operations,
    tags,
    tagGroups,
    schemas,
    schemaNames,
    nodes,
    diagnostics,
  };
}
