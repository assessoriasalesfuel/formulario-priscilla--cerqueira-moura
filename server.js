import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createGoogleSheetsRepository } from './server/googleSheets.js';
import { createLeadService } from './server/leadService.js';

const publicDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

export function createApp({ leadService } = {}) {
  const app = express();
  const service = leadService ?? createLeadService({ repository: createGoogleSheetsRepository() });

  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));

  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  app.post('/api/leads', async (request, response) => {
    const result = await service.createLead(request.body, request.get('Idempotency-Key'));
    response.status(201).json(result);
  });

  app.patch('/api/leads/:leadId', async (request, response) => {
    response.json(await service.updateLead(request.params.leadId, request.body));
  });

  app.post('/api/leads/:leadId/complete', async (request, response) => {
    response.json(await service.completeLead(request.params.leadId, request.body));
  });

  app.post('/api/leads/:leadId/whatsapp', async (request, response) => {
    response.json(await service.registerWhatsAppAccess(request.params.leadId));
  });

  app.use('/api', (_request, response) => {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint não encontrado.' } });
  });

  app.use(express.static(publicDirectory, {
    dotfiles: 'ignore',
    index: 'index.html',
    redirect: false,
  }));

  app.use((error, _request, response, _next) => {
    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    const clientStatus = statusCode >= 400 && statusCode < 600 ? statusCode : 500;
    response.status(clientStatus).json({
      error: {
        code: error.code ?? 'INTERNAL_ERROR',
        message: clientStatus === 500 ? 'Não foi possível concluir a solicitação.' : error.message,
      },
    });
  });

  return app;
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  const port = Number(process.env.PORT) || 3000;
  const host = '0.0.0.0';
  createApp().listen(port, host, () => {
    console.log(`Servidor disponível em http://${host}:${port}`);
  });
}
