import { createServer } from 'node:http';
import {
  mkdir, mkdtemp, readFile, realpath, rm, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderSite } from './openapi-to-html.mjs';

/**
 * Generate frozen API fixtures and serve the normal AEM page shell locally.
 * @param {object} options Preview options.
 * @param {number} options.port Loopback port; zero selects a free port for tests.
 * @returns {Promise<object>} Server, temporary output directory, URL and cleanup function.
 */
export async function startPreview({ port = 3001 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw Error('API_PREVIEW_PORT must be an integer between 0 and 65535.');
  }
  const root = await realpath(fileURLToPath(new URL('../..', import.meta.url)));
  const outputDir = await mkdtemp(path.join(tmpdir(), 'aem-api-preview-'));
  const pages = new Map();
  const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.png': 'image/png',
  };
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    const send = (status, content, type = 'text/plain') => {
      response.writeHead(status, { 'Content-Type': `${type}; charset=utf-8` });
      response.end(request.method === 'HEAD' ? undefined : content);
    };
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD');
      send(405, 'Method not allowed');
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname.includes('\0')) throw Error('Invalid pathname');
    } catch {
      send(400, 'Invalid URL');
      return;
    }
    try {
      if (pathname === '/') {
        send(200, '<!doctype html><html lang="en"><title>Local API preview</title>'
          + '<h1>Local API preview</h1><ul>'
          + '<li><a href="/docs/admin">Admin API</a></li>'
          + '<li><a href="/docs/api">API Service</a></li></ul></html>', 'text/html');
        return;
      }
      if (pathname.endsWith('/') && pages.has(pathname.slice(0, -1))) {
        response.writeHead(302, { Location: pathname.slice(0, -1) });
        response.end();
        return;
      }
      if (pages.has(pathname)) {
        send(200, await readFile(pages.get(pathname)), 'text/html');
        return;
      }
      if (pathname === '/favicon.ico') {
        send(200, await readFile(path.join(root, 'favicon.ico')), 'image/x-icon');
        return;
      }
      if (pathname === '/test/harness.js') {
        send(200, await readFile(path.join(root, 'test/harness.js')), types['.js']);
        return;
      }
      if (/^\/test\/(docs|widgets)\/[a-z0-9-]+\.test\.html$/.test(pathname)) {
        send(200, await readFile(path.join(root, pathname)), 'text/html');
        return;
      }
      const fragment = pathname.replace(/^\/test\/docs\/fixtures/, '');
      if (['/api/header.plain.html', '/api/footer.plain.html'].includes(fragment)) {
        send(200, await readFile(path.join(root, 'test/docs/fixtures', fragment)), 'text/html');
        return;
      }
      if (/^\/(scripts|styles|blocks|widgets|deps|fonts|icons)\//.test(pathname)) {
        const file = await realpath(path.resolve(root, `.${pathname}`));
        const relative = path.relative(root, file);
        if (/^(scripts|styles|blocks|widgets|deps|fonts|icons)\//.test(relative)
          && Object.hasOwn(types, path.extname(file))) {
          send(200, await readFile(file), types[path.extname(file)]);
          return;
        }
      }
      send(404, 'Not found in the local API preview');
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code)) {
        send(404, 'Not found in the local API preview');
      } else {
        process.stderr.write(`API preview request failed: ${error.stack}\n`);
        send(500, 'API preview request failed; see terminal output');
      }
    }
  });
  const close = async () => {
    if (server.listening) {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      });
    }
    await rm(outputDir, { recursive: true, force: true });
  };
  try {
    await Promise.all(['admin', 'api'].map(async (version) => {
      const input = JSON.parse(await readFile(
        path.join(root, 'test/docs/fixtures/bundles', `${version}.json`),
        'utf8',
      ));
      const files = renderSite(input, { version });
      await Promise.all(Object.entries(files).map(async ([name, html]) => {
        const file = path.join(outputDir, 'docs', version, name);
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, html);
        const route = `/docs/${version}/${name}`.replace(/\/index\.html$/, '');
        pages.set(route, file);
      }));
    }));
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
  } catch (error) {
    await close();
    throw error;
  }
  return {
    server, outputDir, url: `http://127.0.0.1:${server.address().port}`, close,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const preview = await startPreview({
    port: process.env.API_PREVIEW_PORT === undefined ? 3001 : Number(process.env.API_PREVIEW_PORT),
  });
  const stop = async () => {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await preview.close();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.stdout.write(`Local API preview: ${preview.url}/\n`
    + `  Admin API: ${preview.url}/docs/admin\n`
    + `  API Service: ${preview.url}/docs/api\n`
    + `Temporary HTML: ${preview.outputDir}\n`
    + 'CSS/JS: refresh the browser. Generator/fixtures: restart this command.\n'
    + 'Stop and remove temporary HTML: Ctrl+C\n');
}
