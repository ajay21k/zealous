import { defineConfig, loadEnv, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';

function readJsonBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function geminiDevProxyPlugin(): Plugin {
  let apiKey = '';
  let defaultModel = 'gemini-3.1-flash-lite';

  const attachRoutes = (middlewares: {
    use: (
      path: string,
      handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void
    ) => void;
  }) => {
    middlewares.use('/api/gemini/status', (_req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ configured: Boolean(apiKey), defaultModel }));
    });

    middlewares.use('/api/gemini/generate', async (req, res, next) => {
      if (req.method !== 'POST') {
        next();
        return;
      }
      if (!apiKey) {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'GEMINI_API_KEY is not configured in .env.local' }));
        return;
      }

      try {
        const raw = await readJsonBody(req);
        const { model, payload } = JSON.parse(raw) as { model?: string; payload: unknown };
        const candidates = Array.from(
          new Set([
            model || defaultModel,
            'gemini-3.1-flash-lite',
            'gemini-3-flash-preview',
            'gemini-flash-latest',
          ])
        );

        let lastStatus = 500;
        let lastBody = '';

        for (const candidate of candidates) {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
            candidate
          )}:generateContent?key=${encodeURIComponent(apiKey)}`;

          const upstream = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          lastStatus = upstream.status;
          lastBody = await upstream.text();

          if (upstream.ok) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(lastBody);
            return;
          }
          // Retry next model only on 404 (deprecated) or 503 (transient capacity)
          if (upstream.status !== 404 && upstream.status !== 503) {
            break;
          }
        }

        res.statusCode = lastStatus;
        res.setHeader('Content-Type', 'application/json');
        res.end(lastBody);
      } catch (err) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            error: err instanceof Error ? err.message : 'Failed to proxy Gemini request',
          })
        );
      }
    });
  };

  return {
    name: 'vyapaarai-gemini-dev-proxy',
    configResolved(config) {
      const env = loadEnv(config.mode, config.root, '');
      apiKey = (env.GEMINI_API_KEY || '').trim();
      defaultModel = (env.GEMINI_MODEL || 'gemini-3.1-flash-lite').trim();
    },
    configureServer(server) {
      attachRoutes(server.middlewares);
    },
    configurePreviewServer(server) {
      attachRoutes(server.middlewares);
    },
  };
}

export default defineConfig({
  plugins: [react(), geminiDevProxyPlugin()],
  build: {
    target: 'esnext',
  },
});
