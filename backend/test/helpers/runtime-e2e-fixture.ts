/**
 * Shared fixtures + docker helpers for the gated Docker E2E suites.
 * Kept in test/helpers (never shipped) and only imported by gated tests.
 */
import { execFileSync } from 'node:child_process';

export function dockerAvailable(): boolean {
  try {
    execFileSync('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 10_000, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export function runDocker(args: string[], timeoutMs = 900_000): string {
  return execFileSync('docker', [...args], { timeout: timeoutMs, stdio: 'pipe', encoding: 'utf8' });
}

export async function pollReady(
  probe: () => Promise<boolean> | boolean,
  timeoutMs: number,
  label: string
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await probe()) return;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`timeout waiting for ${label}`);
}

export const RUNTIME_IMAGE_LABEL = 'amass.runtime=1';

// Runtime-sandbox E2E topology constants (dedicated ephemeral PostgreSQL on a
// non-default host port so the compose/dev database on 5432 is never touched).
export const RUNTIME_E2E_ENABLED = process.env.RUNTIME_SANDBOX_E2E === '1' && dockerAvailable();
export const RUNTIME_E2E_POSTGRES_URL = 'postgresql://amass:amass@127.0.0.1:15432/amass_test';
export const RUNTIME_E2E_PG_NAME = 'amass-e2e-runtime-pg';
export const RUNTIME_E2E_SCAN_ID = 'scan_runtime_e2e';
export const RUNTIME_E2E_TB_IMAGE = 'amass-e2e-toolbox:latest';

// Intentionally vulnerable Python app (stdlib only — sqlite3 + http.server).
export const VULNERABLE_APP = `import http.server, sqlite3, os
from urllib.parse import parse_qs, urlparse

DBP = '/tmp/vuln.db'
if os.path.exists(DBP): os.remove(DBP)
con = sqlite3.connect(DBP)
con.execute('CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, price REAL)')
con.executemany('INSERT INTO products (name, price) VALUES (?,?)', [
  ('laptop', 1200.0), ('mouse', 25.0), ('monitor', 300.0)])
con.commit(); con.close()

class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        q = (parse_qs(urlparse(self.path).query).get('q') or [''])[0]
        if not q:
            data = b'<html><body><a href="/search?q=1">search</a></body></html>'
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        con = sqlite3.connect(DBP)
        try:
            # INTENTIONALLY VULNERABLE: unsanitized user input reaches SQL.
            rows = con.execute(f"SELECT name, price FROM products WHERE id = {q}").fetchall()
        except sqlite3.Error:
            rows = []
        finally:
            con.close()
        if rows:
            body = '<html><body>' + ''.join(f'<p>{n} {p}</p>' for n, p in rows) + '</body></html>'
        else:
            body = '<html><body><p>NOT FOUND</p></body></html>'
        data = body.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)
    def log_message(self, *a): pass

http.server.ThreadingHTTPServer(('0.0.0.0', 8000), H).serve_forever()
`;

export const TOOLBOX_DOCKERFILE = `FROM python:3.11-slim
RUN pip install --no-cache-dir sqlmap >/dev/null 2>&1
CMD ["tail", "-f", "/dev/null"]
`;