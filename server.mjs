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

async function handleYuTVSearch(req, res, query) {
  // Use the first Invidious instance for search
  const instance = INVIDIOUS_INSTANCES[0];
  const invidiousUrl = `${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video&page=1`;

  try {
    const proxyRes = await fetch(invidiousUrl, {
      method: 'GET',
      headers: {
        'User-Agent': req.headers['user-agent'] || 'ytify-proxy',
        'Accept': 'application/json',
        'Accept-Encoding': 'identity',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!proxyRes.ok) {
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ code: 502, msg: '搜索请求失败', list: [] }));
      return;
    }

    const rawBuf = await proxyRes.arrayBuffer();
    const buf = await decompressIfNeeded(proxyRes, rawBuf);
    const items = JSON.parse(buf.toString('utf-8'));

    // Convert Invidious format to YuTV format
    const list = [];
    for (const item of items) {
      if (item.type !== 'video') continue;

      // Get thumbnail URL
      let vod_pic = '';
      if (item.videoThumbnails && item.videoThumbnails.length > 0) {
        // Use the highest quality thumbnail
        const thumb = item.videoThumbnails[item.videoThumbnails.length - 1];
        vod_pic = thumb.url;
        // Make relative URLs absolute
        if (vod_pic.startsWith('/')) {
          vod_pic = instance + vod_pic;
        }
      }

      // Format duration as HH:MM:SS
      const duration = item.lengthSeconds || 0;
      const hours = Math.floor(duration / 3600);
      const minutes = Math.floor((duration % 3600) / 60);
      const secs = duration % 60;
      const durationStr = hours > 0
        ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
        : `${minutes}:${String(secs).padStart(2, '0')}`;

      list.push({
        vod_id: item.videoId,
        vod_name: item.title,
        vod_pic: vod_pic,
        vod_remarks: durationStr + (item.liveNow ? ' [LIVE]' : ''),
        vod_year: new Date(item.published * 1000).getFullYear().toString(),
        vod_area: '',
        vod_actor: item.author || '',
        vod_director: '',
        vod_content: item.description || '',
        type_name: 'YouTube',
        source_name: 'YouTube',
        source_code: 'youtube',
      });
    }

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ code: 200, list }));
  } catch (err) {
    console.error('YuTV search error:', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ code: 500, msg: err.message, list: [] }));
  }
}

async function handleYuTVDetail(req, res, videoId) {
  // Validate videoId format (YouTube video IDs are 11 chars, alphanumeric + _ -)
  if (!/^[\w-]{11}$/.test(videoId)) {
    res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ code: 400, msg: '无效的视频ID', episodes: [], list: [] }));
    return;
  }

  try {
    const data = await fetchInvidiousVideo(videoId);
    if (!data) {
      res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ code: 502, msg: '获取视频详情失败', episodes: [], list: [] }));
      return;
    }

    // Get thumbnail
    let vod_pic = '';
    if (data.videoThumbnails && data.videoThumbnails.length > 0) {
      const thumb = data.videoThumbnails[data.videoThumbnails.length - 1];
      vod_pic = thumb.url;
      if (vod_pic.startsWith('/')) {
        vod_pic = INVIDIOUS_INSTANCES[0] + vod_pic;
      }
    }

    // Build play URL - use formatStreams (combined audio+video, directly playable)
    // YuTV expects vod_play_url in format: "name1$url1#name2$url2"
    const playUrls = [];

    if (data.formatStreams) {
      for (const f of data.formatStreams) {
        const quality = f.qualityLabel || f.resolution || 'unknown';
        playUrls.push(`${quality}$${f.url}`);
      }
    }

    // If no formatStreams, fall back to adaptiveFormats video-only
    // (note: these are video-only, audio must be handled separately by player)
    if (playUrls.length === 0 && data.adaptiveFormats) {
      const videoFormats = data.adaptiveFormats
        .filter(f => f.type && f.type.startsWith('video') && f.url)
        .sort((a, b) => {
          const resA = parseInt(a.resolution) || 0;
          const resB = parseInt(b.resolution) || 0;
          return resB - resA;
        })
        .slice(0, 10); // Limit to 10 formats

      for (const f of videoFormats) {
        const quality = f.resolution || f.qualityLabel || 'unknown';
        playUrls.push(`${quality}$${f.url}`);
      }
    }

    const vod_play_url = playUrls.join('#');

    // Format duration
    const duration = data.lengthSeconds || 0;
    const hours = Math.floor(duration / 3600);
    const minutes = Math.floor((duration % 3600) / 60);
    const secs = duration % 60;
    const durationStr = hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
      : `${minutes}:${String(secs).padStart(2, '0')}`;

    const videoDetail = {
      vod_id: data.videoId,
      vod_name: data.title,
      vod_pic: vod_pic,
      vod_play_url: vod_play_url,
      vod_year: new Date(data.published * 1000).getFullYear().toString(),
      vod_area: '',
      vod_actor: data.author || '',
      vod_director: '',
      vod_content: data.description || '',
      vod_remarks: durationStr + (data.liveNow ? ' [LIVE]' : ''),
      type_name: 'YouTube',
      source_name: 'YouTube',
      source_code: 'youtube',
    };

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ code: 200, list: [videoDetail] }));
  } catch (err) {
    console.error('YuTV detail error:', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ code: 500, msg: err.message, episodes: [], list: [] }));
  }
}

async function fetchInvidiousVideo(videoId) {
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      const url = `${instance}/api/v1/videos/${videoId}`;
      const proxyRes = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'ytify-proxy',
          'Accept': 'application/json',
          'Accept-Encoding': 'identity',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (proxyRes.ok) {
        const rawBuf = await proxyRes.arrayBuffer();
        const buf = await decompressIfNeeded(proxyRes, rawBuf);
        return JSON.parse(buf.toString('utf-8'));
      }
    } catch (err) {
      console.warn('Instance failed for detail:', instance, err.message);
    }
  }
  return null;
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

    // YuTV compatible API endpoints
    // /api/search?wd=keyword or /api/?ac=videolist&wd=keyword
    if (pathname === '/api/search' || (pathname === '/api/' && (url.searchParams.has('wd') || url.searchParams.has('q')))) {
      const query = url.searchParams.get('wd') || url.searchParams.get('q');
      if (!query) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ code: 400, msg: '缺少搜索参数', list: [] }));
        return;
      }
      return handleYuTVSearch(req, res, query);
    }

    // /api/detail?id=videoId or /api/?ac=videolist&ids=videoId
    if (pathname === '/api/detail' || (pathname === '/api/' && (url.searchParams.has('id') || url.searchParams.has('ids')))) {
      const videoId = url.searchParams.get('id') || url.searchParams.get('ids');
      if (!videoId) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ code: 400, msg: '缺少视频ID', episodes: [], list: [] }));
        return;
      }
      return handleYuTVDetail(req, res, videoId);
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
