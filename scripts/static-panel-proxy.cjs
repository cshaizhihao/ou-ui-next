#!/usr/bin/env node

const { createReadStream, existsSync, statSync } = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { createGzip } = require('node:zlib');

const defaultProxyPrefixes = ['/api/', '/agent/', '/events/', '/sub/', '/portal/', '/telegram/'];
const defaultProxyExact = new Set(['/metrics']);
const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff2', 'font/woff2']
]);

function shouldProxy(pathname, options = {}) {
  const exact = options.exact ?? defaultProxyExact;
  const prefixes = options.prefixes ?? defaultProxyPrefixes;
  return exact.has(pathname) || prefixes.some((prefix) => pathname.startsWith(prefix));
}

function resolveStaticFile(staticRoot, urlPathname) {
  const root = path.resolve(staticRoot);
  let pathname;

  try {
    pathname = decodeURIComponent(urlPathname);
  } catch {
    return undefined;
  }

  if (pathname.split(/[\\/]+/).includes('..')) {
    return undefined;
  }

  if (pathname === '/' || pathname.endsWith('/')) {
    pathname += 'index.html';
  }

  const normalized = path.normalize(pathname).replace(/^[/\\]+/, '');
  const candidate = path.resolve(root, normalized);
  const rootWithSeparator = root.endsWith(path.sep) ? root : `${root}${path.sep}`;

  if (candidate !== root && !candidate.startsWith(rootWithSeparator)) {
    return undefined;
  }

  if (existsSync(candidate) && statSync(candidate).isFile()) {
    return candidate;
  }

  return path.join(root, 'index.html');
}

function proxyRequest(req, res, backend) {
  const target = new URL(req.url || '/', backend);
  const headers = {
    ...req.headers,
    host: backend.host
  };
  const upstream = http.request(target, { method: req.method, headers }, (upstreamRes) => {
    const contentType = String(upstreamRes.headers['content-type'] || '');
    const acceptsGzip = /(?:^|,)\s*gzip\s*(?:,|$)/i.test(String(req.headers['accept-encoding'] || ''));
    const shouldCompress =
      acceptsGzip &&
      !upstreamRes.headers['content-encoding'] &&
      !contentType.includes('text/event-stream') &&
      /(?:application\/json|text\/|javascript|svg\+xml)/i.test(contentType);

    if (!shouldCompress) {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
      return;
    }

    const responseHeaders = { ...upstreamRes.headers };
    delete responseHeaders['content-length'];
    responseHeaders['content-encoding'] = 'gzip';
    responseHeaders.vary = responseHeaders.vary ? `${responseHeaders.vary}, Accept-Encoding` : 'Accept-Encoding';
    res.writeHead(upstreamRes.statusCode || 502, responseHeaders);
    upstreamRes.pipe(createGzip({ level: 1 })).pipe(res);
  });

  upstream.on('error', (error) => {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`Backend proxy failed: ${error.message}`);
  });

  req.pipe(upstream);
}

function serveStatic(req, res, staticRoot, pathname) {
  const file = resolveStaticFile(staticRoot, pathname);

  if (!file) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Static root is missing index.html. Run npm run build first.');
    return;
  }

  const ext = path.extname(file);
  res.writeHead(200, {
    'cache-control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable',
    'content-type': mimeTypes.get(ext) || 'application/octet-stream'
  });
  createReadStream(file).pipe(res);
}

function createStaticPanelProxyServer(options = {}) {
  const staticRoot = path.resolve(options.staticRoot ?? process.env.OU_UI_STATIC_ROOT ?? 'dist');
  const backend = new URL(options.backendUrl ?? process.env.OU_UI_BACKEND_URL ?? 'http://127.0.0.1:4010');
  const host = options.host ?? process.env.OU_UI_STATIC_HOST ?? '127.0.0.1';
  const port = Number(options.port ?? process.env.OU_UI_STATIC_PORT ?? 4173);

  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`);

    if (shouldProxy(requestUrl.pathname)) {
      proxyRequest(req, res, backend);
      return;
    }

    serveStatic(req, res, staticRoot, requestUrl.pathname);
  });

  return {
    backend,
    host,
    port,
    server,
    staticRoot
  };
}

if (require.main === module) {
  const { backend, host, port, server, staticRoot } = createStaticPanelProxyServer();

  server.listen(port, host, () => {
    process.stdout.write(`OU-UI static proxy listening at http://${host}:${port} -> ${backend.origin}, root=${staticRoot}\n`);
  });

  const shutdown = () => {
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = {
  createStaticPanelProxyServer,
  defaultProxyExact,
  defaultProxyPrefixes,
  resolveStaticFile,
  shouldProxy
};
