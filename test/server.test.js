import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp, createRateLimiter } from '../server.js';
import { createLeadService } from '../server/leadService.js';
import { FORM_CONFIG } from '../public/js/formConfig.js';

const ID = '20000000-0000-4000-8000-000000000002';
function payload() {
  return {
    submissionId: ID, privacyNoticeVersion: FORM_CONFIG.privacyNoticeVersion, attribution: {},
    answers: {
      legalSituation: 'protective_order_received', primaryConcern: 'restrictions_and_consequences',
      hiringIntent: 'asap', paymentMethod: 'cash',
      name: 'Pessoa de Teste', phone: '27999999999',
      privacyAcknowledged: true, contactConsent: true,
    },
  };
}

async function withServer(run, { rateLimiter } = {}) {
  const records = [];
  const repository = {
    records,
    async append(record) { records.push({ ...record }); },
    async findBySubmissionId(id) {
      const index = records.findIndex((record) => record.submissionId === id);
      return index < 0 ? null : { rowNumber: index + 2, record: records[index] };
    },
  };
  const service = createLeadService({ repository, now: () => new Date('2026-10-16T12:00:00Z') });
  const server = createApp({ leadService: service, rateLimiter }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await run(`http://127.0.0.1:${server.address().port}`, records); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('API registra, classifica e retorna WhatsApp sem expor cabeçalhos do servidor', async () => {
  await withServer(async (baseUrl, records) => {
    const response = await fetch(`${baseUrl}/api/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': ID },
      body: JSON.stringify(payload()),
    });
    assert.equal(response.status, 201);
    assert.equal(response.headers.has('x-powered-by'), false);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/u);
    assert.doesNotMatch(response.headers.get('content-security-policy'), /unsafe-inline|fonts\.googleapis/u);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.deepEqual((({ completionAction, whatsappEligible }) => (
      { completionAction, whatsappEligible }
    ))(await response.json()), { completionAction: 'whatsapp', whatsappEligible: true });
    assert.equal(records.length, 1);
  });
});

test('API retorna erro controlado e limita tentativas', async () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => 0 });
  await withServer(async (baseUrl) => {
    const options = { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': ID }, body: JSON.stringify(payload()) };
    assert.equal((await fetch(`${baseUrl}/api/leads`, options)).status, 201);
    const limited = await fetch(`${baseUrl}/api/leads`, options);
    assert.equal(limited.status, 429);
    assert.deepEqual(Object.keys((await limited.json()).error), ['code', 'message']);
  }, { rateLimiter: limiter });
});

test('API desconhecida retorna 404 em JSON', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/legado`, { method: 'POST' });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'NOT_FOUND');
  });
});

test('estado da integração reflete a verificação real sem expor detalhes internos', async () => {
  const service = { async submitLead() { throw new Error('não utilizado'); } };
  const app = createApp({ leadService: service, integrationChecker: async () => undefined });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/integration-status`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { googleSheets: 'operational' });
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('estado da integração informa indisponibilidade sem sucesso fictício', async () => {
  const service = { async submitLead() { throw new Error('não utilizado'); } };
  const unavailable = Object.assign(new Error('A integração com Google Sheets não está configurada.'),
    { code: 'SHEETS_UNAVAILABLE' });
  const app = createApp({ leadService: service, integrationChecker: async () => { throw unavailable; } });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/integration-status`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      googleSheets: 'unavailable',
      error: { code: 'SHEETS_UNAVAILABLE', message: 'A integração com Google Sheets não está configurada.' },
    });
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('API rejeita JSON malformado sem expor detalhes do parser', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/leads`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"incompleto":',
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: { code: 'INVALID_JSON', message: 'O corpo da solicitação deve conter JSON válido.' },
    });
  });
});

test('limitador mantém quantidade máxima de clientes em memória', () => {
  const limiter = createRateLimiter({ maxClients: 1, now: () => 0 });
  const responses = [];
  const response = {
    set() { return this; },
    status(statusCode) { this.statusCode = statusCode; return this; },
    json(body) { responses.push({ statusCode: this.statusCode, body }); },
  };
  let accepted = 0;
  limiter({ ip: 'primeiro' }, response, () => { accepted += 1; });
  limiter({ ip: 'segundo' }, response, () => { accepted += 1; });
  assert.equal(accepted, 1);
  assert.deepEqual(responses, [{
    statusCode: 429,
    body: { error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Aguarde e tente novamente.' } },
  }]);
});
