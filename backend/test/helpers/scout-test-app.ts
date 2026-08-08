import express, { type Express } from 'express';
import type { Server } from 'node:http';

/**
 * A small live application used by Scout integration tests. Covers the
 * surface recon looks for: crawlable pages, login (password form), a protected
 * admin area, upload (multipart), REST/GraphQL endpoints, API docs, a
 * WebSocket route, robots.txt + sitemap, and a static asset.
 */
export function createScoutTestApp(): Express {
  const app = express();

  app.get('/', (_req, res) => {
    res.type('html').send(`
      <html><head><title>Demo</title></head>
      <body>
        <h1>Demo app</h1>
        <a href="/about">About</a>
        <a href="/login">Login</a>
        <a href="/admin/users">Admin</a>
        <a href="/api/v1/items?limit=10">Items API</a>
        <a href="/assets/logo.png">Logo</a>
        <script>const ws = new WebSocket('ws://localhost/ws');</script>
        <form method="post" action="/api/search">
          <input name="query"><input type="submit">
        </form>
      </body></html>
    `);
  });

  app.get('/about', (_req, res) => {
    res.type('html').send('<h1>About</h1><p>demo</p>');
  });

  app.get('/login', (_req, res) => {
    res
      .type('html')
      .status(200)
      .send('<form method="post" action="/login"><input name="user"><input name="password" type="password"><button>Go</button></form>');
  });

  app.get('/admin/users', (_req, res) => {
    res.status(401).type('text/plain').send('unauthorized');
  });

  app.get('/api/v1/items', (_req, res) => {
    res.json({ items: [{ id: 1 }, { id: 2 }] });
  });

  app.post('/api/search', (req, res) => {
    res.json({ ok: true, q: req.body?.q });
  });

  app.get('/graphql', (_req, res) => {
    res.status(400).json({ errors: [{ message: 'Must provide operation name' }] });
  });

  app.get(['/ws', '/websocket'], (_req, res) => {
    res.type('text/plain').status(200).send('socket upgraded');
  });

  app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

  app.get('/docs', (_req, res) => {
    res.type('html').status(200).send('<h1>API Docs</h1>');
  });

  app.get('/openapi.json', (_req, res) => res.json({ openapi: '3.0.0' }));

  app.get('/upload', (_req, res) => {
    res.type('html').send('<form action="/upload" enctype="multipart/form-data"><input name="file"><input type="submit"></form>');
  });

  app.get('/public/logo.png', (_req, res) => {
    res.type('png').status(200).send('png');
  });

  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain').status(200).send('User-agent: *\nDisallow: /admin\nSitemap: /sitemap.xml\n');
  });

  app.get('/sitemap.xml', (_req, res) => {
    res.type('xml').status(200).send('<urlset><url><loc>/about</loc></url></urlset>');
  });

  return app;
}

/** Start the test app on an ephemeral port; returns origin + server. */
export async function startScoutTestServer(): Promise<{ origin: string; server: Server; close: () => Promise<void> }> {
  const app = createScoutTestApp();
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const addr = server.address();
  const origin =
    typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : 'http://127.0.0.1';
  return {
    origin,
    server,
    close: () =>
      new Promise((resolve) => server.close(() => resolve())),
  };
}