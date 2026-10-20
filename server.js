import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createGoogleSheetsRepository } from './server/googleSheets.js';
import { createLeadService } from './server/leadService.js';

const projectDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(projectDirectory, 'public');

export function loadProjectEnvironment() {
  const environmentFile = path.join(projectDirectory, '.env');
  if (existsSync(environmentFile)) process.loadEnvFile(environmentFile);
}

export function createRateLimiter({ limit = 30, windowMs = 10 * 60 * 1000, maxClients = 10_000, now = Date.now } = {}) {
  const clients = new Map();
  return (request, response, next) => {
    const timestamp = now();
    if (clients.size >= maxClients) {
      for (const [key, entry] of clients) {
        if (timestamp - entry.startedAt >= windowMs) clients.delete(key);
      }
    }
    const key = request.ip || request.socket.remoteAddress || 'unknown';
    const entry = clients.get(key);
    if (!entry || timestamp - entry.startedAt >= windowMs) {
      if (!entry && clients.size >= maxClients) {
        response.set('Retry-After', String(Math.ceil(windowMs / 1000)));
        response.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Aguarde e tente novamente.' } });
        return;
      }
      clients.set(key, { startedAt: timestamp, count: 1 });
      next();
      return;
    }
    entry.count += 1;
    if (entry.count <= limit) {
      next();
      return;
    }
    response.set('Retry-After', String(Math.ceil((windowMs - (timestamp - entry.startedAt)) / 1000)));
    response.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Aguarde e tente novamente.' } });
  };
}

export function createApp({ leadService, rateLimiter, environment = process.env, integrationChecker } = {}) {
  const app = express();
  const repository = leadService ? undefined : createGoogleSheetsRepository({ environment });
  const service = leadService ?? createLeadService({ repository });
  const checkIntegration = integrationChecker ?? (repository
    ? () => repository.verifyConnection()
    : async () => undefined);

  app.disable('x-powered-by');
  if (environment.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.use((_request, response, next) => {
    response.set({
      'Content-Security-Policy': "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'",
      'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.get('/health', (_request, response) => response.status(200).json({ status: 'ok' }));
  app.use('/api', (_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });
  app.get('/api/integration-status', async (_request, response) => {
    try {
      await checkIntegration();
      response.status(200).json({ googleSheets: 'operational' });
    } catch (error) {
      response.status(503).json({
        googleSheets: 'unavailable',
        error: {
          code: error?.code ?? 'SHEETS_UNAVAILABLE',
          message: error?.message ?? 'A integração com Google Sheets está indisponível.',
        },
      });
    }
  });
  app.post('/api/leads', rateLimiter ?? createRateLimiter(), async (request, response) => {
    const result = await service.submitLead(request.body, request.get('Idempotency-Key'));
    response.status(201).json(result);
  });
  app.use('/api', (_request, response) => {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint não encontrado.' } });
  });
  app.use(express.static(publicDirectory, { dotfiles: 'ignore', index: 'index.html', redirect: false }));
  app.use((error, _request, response, _next) => {
    if (error.type === 'entity.parse.failed') {
      response.status(400).json({ error: { code: 'INVALID_JSON', message: 'O corpo da solicitação deve conter JSON válido.' } });
      return;
    }
    if (error.type === 'entity.too.large') {
      response.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'A solicitação excede o tamanho permitido.' } });
      return;
    }
    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    const clientStatus = statusCode >= 400 && statusCode < 600 ? statusCode : 500;
    response.status(clientStatus).json({ error: {
      code: error.code ?? 'INTERNAL_ERROR',
      message: clientStatus === 500 ? 'Não foi possível concluir a solicitação.' : error.message,
    } });
  });
  return app;
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  loadProjectEnvironment();
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, '0.0.0.0', () => console.log(`Servidor disponível na porta ${port}`));
}
