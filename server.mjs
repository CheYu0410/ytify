import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createGunzip } from 'zlib';
import { Readable } from 'stream';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4534;
const STATIC_DIR = path.join(__dirname, 'dist');
const CF_WORKER = 'https://api.ytify.workers.dev';
const INVIDIOUS_INSTANCES = [
  'https://yt.omada.cafe',
  'https://lekker.gay',
];

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

function filterHeaders(proxyRes) {
  const headers = {};
  for (const [k, v] of proxyRes.headers) {
    const lower = k.toLowerCase();
    if (lower.startsWith('access-control-')) continue;
    if (lower === 'content-encoding') continue;
    if (lower === 'content-length') continue;
    headers[k] = v;
  }
  headers['Access-Control-Allow-Origin'] = '*';
  headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
  headers['Access-Control-Allow-Headers'] = 'Content-Type';
  return headers;
}

async function decompressIfNeeded(proxyRes, buf) {
  const encoding = proxyRes.headers.get('content-encoding');
  if (encoding === 'gzip' || encoding === 'deflate') {
    return new Promise((resolve, reject) => {
      const gunzip = createGunzip();
      const chunks = [];
      Readable.from(Buffer.from(buf))
        .pipe(gunzip)
        .on('data', c => chunks.push(c))
        .on('end', () => resolve(Buffer.concat(chunks)))
        .on('error', reject);
    });
  }
  return Buffer.from(buf);
}

async function doProxy(targetUrl, req, res) {
  try {
    const proxyRes = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'User-Agent': req.headers['user-agent'] || 'ytify-proxy',
        'Accept': req.headers['accept'] || '*/*',
        'Accept-Encoding': 'identity',
      },
      signal: AbortSignal.timeout(15000),
    });

    res.writeHead(proxyRes.status, filterHeaders(proxyRes));
    const rawBuf = await proxyRes.arrayBuffer();
    const buf = await decompressIfNeeded(proxyRes, rawBuf);
    res.end(buf);
  } catch (err) {
    console.error('Proxy error:', err.message, targetUrl);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }
}

async function doProxyWithFallback(req, res, instances, pathAndQuery) {
  for (const instance of instances) {
    try {
      const url = instance + pathAndQuery;
      const proxyRes = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': req.headers['user-agent'] || 'ytify-proxy',
          'Accept': req.headers['accept'] || '*/*',
          'Accept-Encoding': 'identity',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (proxyRes.ok) {
        res.writeHead(proxyRes.status, filterHeaders(proxyRes));
        const rawBuf = await proxyRes.arrayBuffer();
        const buf = await decompressIfNeeded(proxyRes, rawBuf);
        res.end(buf);
        return;
      }
    } catch (err) {
      console.warn('Instance failed:', instance, err.message);
    }
  }

  if (!res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'All instances failed' }));
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost`);
  const pathname = url.pathname;

  const isApi = pathname.startsWith('/api/') || pathname.startsWith('/search') || pathname.startsWith('/search-suggestions');

  if (isApi) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    if (pathname.startsWith('/api/v1/videos/')) {
      doProxyWithFallback(req, res, INVIDIOUS_INSTANCES, pathname + url.search);
      return;
    }

    doProxy(CF_WORKER + pathname + url.search, req, res);
    return;
  }

  // Static files
  let filePath = path.join(STATIC_DIR, pathname);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(STATIC_DIR, 'index.html');
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`ytify server running on http://0.0.0.0:${PORT}`);
});
