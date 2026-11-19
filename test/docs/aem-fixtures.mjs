// Selected fields from the frozen AEM bundles, not invented request examples.
// Admin API: helix-admin 068a377a, schemas/bulkPublishBody and access-site.
// API Service: helix-api-service 6779ccac, sourceFile/get and sourceFile/put.
export const accessSchema = {
  title: 'Site Access Config',
  type: 'object',
  properties: {
    allow: {
      description: 'The email glob of the users or a group reference that are allowed access',
      type: 'array',
      items: { type: 'string' },
    },
    secretId: {
      description: 'IDs of the hashed secrets that are allowed.',
      type: 'array',
      items: { type: 'string', pattern: '^[a-zA-Z0-9-_=+/]+$' },
    },
    apiKeyId: {
      description: 'IDs of the api keys that are allowed. This is deprecated. use `secretId` instead.',
      deprecated: true,
      type: 'array',
      items: { type: 'string' },
    },
  },
  additionalProperties: false,
};

export const bulkPublishBody = {
  description: 'bulk publish body',
  required: ['paths'],
  properties: {
    forceUpdate: {
      description: 'forces an update of the resources during bulk-publish',
      type: 'boolean',
    },
    forceAsync: {
      description: 'forces the job to be executed asynchronous, even for a small number of given paths.',
      type: 'boolean',
    },
    paths: {
      description: 'paths to filter the bulk publish',
      type: 'array',
      items: { type: 'string' },
    },
    delete: {
      description: 'delete the resources from publish',
      type: 'boolean',
      default: false,
    },
  },
};

export const sourceOperations = {
  get: {
    operationId: 'getSourceDocument',
    tags: ['source'],
    summary: 'Get document',
    description: 'Returns the source document content and metadata.',
    security: [{ AuthCookie: ['preview:read'] }],
    responses: {
      200: {
        description: 'The raw content of the source document. The body is returned as-is; its\n'
          + 'format is indicated by the `Content-Type` response header (e.g.\n'
          + '`text/html` for documents, `application/json` for spreadsheets/data,\n'
          + '`application/pdf`, `image/*`, etc.).\n',
        headers: {
          etag: { description: 'ETag of the document', schema: { type: 'string' } },
          'content-length': {
            description: 'Size of the document in bytes', schema: { type: 'integer' },
          },
        },
        content: { '*/*': { schema: { type: 'string', format: 'binary' } } },
      },
    },
  },
  put: {
    operationId: 'putSourceDocument',
    tags: ['source'],
    summary: 'Replace or copy a document',
    security: [{ AuthCookie: ['preview:write'] }],
    requestBody: {
      description: 'The raw content of the document to create. Only required when the\n'
        + '`source` query parameter is not provided; for copy operations the\n'
        + 'body is omitted and the destination is populated from `source` instead.\n'
        + 'When a body is provided, its format must be indicated by the\n'
        + '`Content-Type` request header (e.g. `text/html` for documents,\n'
        + '`application/json`, `application/pdf`, `image/jpeg`, etc.).\n',
      required: false,
      content: { '*/*': { schema: { type: 'string', format: 'binary' } } },
    },
    responses: { 201: { description: 'Document created' } },
  },
};
