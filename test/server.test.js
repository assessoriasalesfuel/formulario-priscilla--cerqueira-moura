import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server.js';
import { createLeadService } from '../server/leadService.js';

function createRepository() {
  const rows = [];
  return {
    rows,
    async append(row) { rows.push([...row]); },
    async findByLeadId(leadId) {
      const index = rows.findIndex((row) => row[0] === leadId);
      return index < 0 ? null : { rowNumber: index + 2, row: [...rows[index]] };
    },
    async update(rowNumber, row) { rows[rowNumber - 2] = [...row]; },
  };
}

async function withServer(run) {
  const repository = createRepository();
  const service = createLeadService({
    repository,
    now: () => new Date('2026-09-18T12:00:00.000Z'),
    createId: () => '10000000-0000-4000-8000-000000000001',
  });
  const server = createApp({ leadService: service }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`, repository);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

const contact = { phone: '27998737944' };
const answers = {
  phone: '27998737944', measureTime: 'less_than_1_month', investment: 'can_invest',
  dataConsent: true, contactConsent: true,
};

test('endpoints executam criação, atualização, conclusão e acesso ao WhatsApp', async () => {
  await withServer(async (baseUrl, repository) => {
    const createResponse = await fetch(`${baseUrl}/api/leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'browser-session' },
      body: JSON.stringify(contact),
    });
    assert.equal(createResponse.status, 201);
    const { leadId } = await createResponse.json();

    const updateResponse = await fetch(`${baseUrl}/api/leads/${leadId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ measureTime: 'less_than_1_month' }),
    });
    assert.equal(updateResponse.status, 200);

    const completeResponse = await fetch(`${baseUrl}/api/leads/${leadId}/complete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(answers),
    });
    assert.deepEqual(await completeResponse.json(), {
      classification: 'qualified', qualified: true, leadId,
    });

    const whatsappResponse = await fetch(`${baseUrl}/api/leads/${leadId}/whatsapp`, { method: 'POST' });
    assert.equal(whatsappResponse.status, 200);
    assert.match((await whatsappResponse.json()).link, /^https:\/\/wa\.me\/5527998737944/u);
    assert.equal(repository.rows.length, 1);
  });
});

test('API retorna erro JSON controlado sem stack trace', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/leads`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error.code, 'INVALID_REQUEST');
    assert.equal('stack' in body.error, false);
    assert.equal(response.headers.has('x-powered-by'), false);
  });
});
