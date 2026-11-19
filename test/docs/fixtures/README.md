# Test fixtures

## Frozen OpenAPI bundles

Byte-for-byte copies of the Admin API and API Service bundles, captured on 2026-10-22, named
by their version (`admin`, `api`). They are the generator's inputs for the Node tests, the
browser tests and the local preview.

| Bundle               | Source revision                                              | API version | SHA-256                                                            |
| -------------------- | ------------------------------------------------------------ | ----------- | ------------------------------------------------------------------ |
| `bundles/admin.json` | helix-admin `068a377a6d3ecfca3c790a75131766e90ac5a8eb`       | `12.147.4`  | `8eeaec5daa234f7627db572afd07d26ff32f742dac1cba1d9599252c24c93449` |
| `bundles/api.json`   | helix-api-service `6779ccac9dc4506ea06e2356fe23363f8a8bfa68` | `1.82.9`    | `6a4f07847671127969e751bce47a147857e2decdda615fd21b8acb37615d89ce` |

They were bundled with Redocly CLI 2.53.0 from the helix-admin `docs/openapi/admin-api.yaml`
and helix-api-service `docs/openapi/api-service.yaml` entry points. The preview test checks
these hashes. Do not refresh them silently from live APIs or source checkouts: a refresh changes
test expectations and should be its own reviewed change. `API_CONTRACT_BASELINE_DIR` points the tests at another
directory with the same layout.

## Authored header and footer

`api/header.plain.html` and `api/footer.plain.html` are snapshots of the authored `/api/header`
and `/api/footer` documents on
`https://main--aem-docs--adobe.aem.page`, captured on 2026-11-09. They contain content only;
the header and footer blocks do all decoration. To refresh one, replace it with the current
`.plain.html` response of its document.
