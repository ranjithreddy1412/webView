import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import url, { URL, URLSearchParams } from 'node:url';

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));
const CLIENT_ID = process.env.TINK_CLIENT_ID;
const CLIENT_SECRET = process.env.TINK_CLIENT_SECRET;

if (!CLIENT_ID) {
  console.error('Missing "TINK_CLIENT_ID"');
  process.exit(1);
}

if (!CLIENT_SECRET) {
  console.error('Missing "TINK_CLIENT_SECRET"');
  process.exit(1);
}

const hostname = 'localhost';
const port = 3000;

const apiUrl = 'https://api.tink.com';

function respondWithError(res, err) {
  if (res.writableEnded) return; // Prevent writing headers if the response is already sent
  res.writeHead(500, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: err.message }));
}

function respondWithJson(res, data) {
  if (res.writableEnded) return; // Prevent writing headers if the response is already sent
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function parseResponse(res) {
  if (!res.ok) {
    throw new Error(`Request failed with "${res.status}"`);
  }
  const data = await res.json();
  return data;
}

function serveStaticContent(req, res) {
  const filePath = path.join(__dirname, '.', req.url);
  const contentType = req.url.endsWith('.js') ? 'text/javascript' : 'text/css';

  res.setHeader('Content-Type', contentType);

  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    if (res.writableEnded) return; // Prevent error handling after response is sent
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });

  stream.pipe(res);
}

async function fetchAccessToken(code) {
  const body = new URLSearchParams({
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'authorization_code',
  });

  const res = await fetch(`${apiUrl}/api/v1/oauth/token`, {
    method: 'POST',
    body,
  });

  return parseResponse(res);
}

async function authenticatedApiProxyHandler(req, res, parsedUrl) {
  const apiPath = parsedUrl.pathname.replace('/api-proxy', '');
  const response = await fetch(`${apiUrl}${apiPath}`, {
    method: req.method,
    headers: {
      Authorization: req.headers.authorization,
    },
  });

  return parseResponse(response);
}

const server = http.createServer(async (req, res) => {
  console.info(`${req.method}: `, req.url);
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (parsedUrl.pathname === '/api/v1/oauth/token' && req.method === 'POST') {
      const codeParam = parsedUrl.searchParams.get('code');
      if (!codeParam) {
        throw new Error('Missing required parameter "code"');
      }
      const response = await fetchAccessToken(codeParam);
      return respondWithJson(res, response);
    }

    if (parsedUrl.pathname.startsWith('/api-proxy')) {
      const response = await authenticatedApiProxyHandler(req, res, parsedUrl);
      return respondWithJson(res, response);
    }

    if (req.url.startsWith('/static')) {
      return serveStaticContent(req, res);
    }

    // Serve index.html for other requests
    res.writeHead(200, { 'content-type': 'text/html' });
    return fs.createReadStream('index.html').pipe(res);

  } catch (err) {
    respondWithError(res, err);
  }
});

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
});
