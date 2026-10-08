import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLUMN_COUNT, createLeadService, normalizeAttribution, protectSheetText,
} from '../server/leadService.js';
import { WHATSAPP_MESSAGE, WHATSAPP_NUMBER } from '../public/js/whatsapp.js';

const FIXED_DATE = new Date('2026-09-18T12:00:00.000Z');
const LEAD_ID = '10000000-0000-4000-8000-000000000001';
const contact = { phone: '(27) 99873-7944' };
const qualifiedAnswers = {
  phone: '(27) 99873-7944',
  measureTime: 'from_1_to_3_months',
  investment: 'needs_installments',
  dataConsent: true,
  contactConsent: true,
};

function createRepository() {
  const rows = [];
  return {
    rows,
    appendCalls: 0,
    updateCalls: 0,
    failAppend: false,
    failUpdate: false,
    async append(row) {
      if (this.failAppend) throw new Error('sheets failure');
      this.appendCalls += 1;
      rows.push([...row]);
    },
    async findByLeadId(leadId) {
      const index = rows.findIndex((row) => row[0] === leadId);
      return index === -1 ? null : { rowNumber: index + 2, row: [...rows[index]] };
    },
    async update(rowNumber, row) {
      if (this.failUpdate) throw new Error('sheets failure');
      this.updateCalls += 1;
      rows[rowNumber - 2] = [...row];
    },
  };
}

function setup(overrides = {}) {
  const repository = createRepository();
  const service = createLeadService({
    repository,
    now: () => FIXED_DATE,
    createId: () => LEAD_ID,
    ...overrides,
  });
  return { repository, service };
}

async function createInitial(service, extra = {}) {
  return service.createLead({ ...contact, ...extra });
}

test('cria lead Mini com telefone normalizado e exatamente 18 colunas', async () => {
  const { repository, service } = setup();
  const result = await createInitial(service);
  assert.deepEqual(result, { leadId: LEAD_ID, status: 'Em preenchimento' });
  assert.equal(repository.rows[0].length, COLUMN_COUNT);
  assert.equal(COLUMN_COUNT, 18);
  assert.equal(repository.rows[0][1], FIXED_DATE.toISOString());
  assert.equal(repository.rows[0][2], 'Em preenchimento');
  assert.equal(repository.rows[0][3], '');
  assert.equal(repository.rows[0][4], '');
  assert.equal(repository.rows[0][5], '27998737944');
  assert.deepEqual(repository.rows[0].slice(6, 10), Array(4).fill(''));
});

test('rejeita WhatsApp inválido e campos antigos na criação', async () => {
  const { service } = setup();
  await assert.rejects(() => service.createLead({ phone: '123' }), /WhatsApp/u);
  await assert.rejects(() => service.createLead({ ...contact, name: 'Campo antigo' }), /criação inválido/u);
  await assert.rejects(() => service.createLead({ ...contact, email: 'antigo@example.com' }), /criação inválido/u);
});

test('atualiza respostas Mini na mesma linha usando rótulos legíveis', async () => {
  const { repository, service } = setup();
  await createInitial(service);
  await service.updateLead(LEAD_ID, { measureTime: 'from_3_to_6_months' });
  await service.updateLead(LEAD_ID, { investment: 'can_invest' });
  assert.equal(repository.rows[0][3], '3 a 6 meses');
  assert.equal(repository.rows[0][4], 'Sim, consigo investir');
  assert.equal(repository.rows.length, 1);
});

test('rejeita opção Mini inválida, payload vazio e campos removidos no PATCH', async () => {
  const { service } = setup();
  await createInitial(service);
  await assert.rejects(() => service.updateLead(LEAD_ID, {}), /atualização inválido/u);
  await assert.rejects(() => service.updateLead(LEAD_ID, { measureTime: 'inventado' }), /measureTime/u);
  await assert.rejects(() => service.updateLead(LEAD_ID, { income: 'up_to_3000' }), /atualização inválido/u);
  await assert.rejects(() => service.updateLead(LEAD_ID, { lastStep: 'phone' }), /atualização inválido/u);
});

test('retorna erro controlado para Lead ID inexistente', async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.updateLead('ausente', { investment: 'can_invest' }),
    (error) => error.statusCode === 404 && error.code === 'LEAD_NOT_FOUND',
  );
});

test('conclui lead qualificado no schema operacional de 18 colunas', async () => {
  const { repository, service } = setup();
  await createInitial(service);
  const result = await service.completeLead(LEAD_ID, qualifiedAnswers);
  assert.deepEqual(result, { classification: 'qualified', qualified: true, leadId: LEAD_ID });
  const row = repository.rows[0];
  assert.equal(row[2], 'Qualificado');
  assert.equal(row[3], '1 a 3 meses');
  assert.equal(row[4], 'Preciso parcelar, mas consigo');
  assert.equal(row[5], '27998737944');
  assert.match(row[6], /Disponibilidade para investimento/u);
  assert.equal(row[7], FIXED_DATE.toISOString());
  assert.equal(row[8], 'Sim');
  assert.equal(row[9], 'Sim');
});

test('tempo superior a 6 meses permanece qualificado quando há investimento', async () => {
  const { repository, service } = setup();
  await createInitial(service);
  const result = await service.completeLead(LEAD_ID, { ...qualifiedAnswers, measureTime: 'more_than_6_months' });
  assert.equal(result.qualified, true);
  assert.equal(repository.rows[0][2], 'Qualificado');
});

test('desqualifica quando não há investimento disponível', async () => {
  const { repository, service } = setup();
  await createInitial(service);
  const result = await service.completeLead(LEAD_ID, { ...qualifiedAnswers, investment: 'cannot_invest_now' });
  assert.equal(result.qualified, false);
  assert.equal(repository.rows[0][2], 'Desqualificado');
});

test('recalcula classificação no servidor e ignora resultado enviado pelo cliente', async () => {
  const { repository, service } = setup();
  await createInitial(service);
  const result = await service.completeLead(LEAD_ID, {
    ...qualifiedAnswers,
    investment: 'cannot_invest_now',
    classification: 'qualified', qualified: true, reason: 'forjado',
  });
  assert.equal(result.qualified, false);
  assert.equal(repository.rows[0][2], 'Desqualificado');
  assert.notEqual(repository.rows[0][6], 'forjado');
});

test('exige ambos os consentimentos na conclusão', async () => {
  const { service } = setup();
  await createInitial(service);
  await assert.rejects(
    () => service.completeLead(LEAD_ID, { ...qualifiedAnswers, contactConsent: false }),
    /confirmações/u,
  );
});

test('data de conclusão é gerada no servidor e permanece idempotente', async () => {
  let currentTime = FIXED_DATE;
  const { repository, service } = setup({ now: () => currentTime });
  await createInitial(service);
  currentTime = new Date('2026-09-18T12:05:00.000Z');
  await service.completeLead(LEAD_ID, { ...qualifiedAnswers, completedAt: '2000-01-01T00:00:00.000Z' });
  currentTime = new Date('2026-09-18T12:10:00.000Z');
  await service.completeLead(LEAD_ID, qualifiedAnswers);
  assert.equal(repository.rows[0][7], '2026-09-18T12:05:00.000Z');
  assert.equal(repository.rows.length, 1);
});

test('falha do Sheets impede confirmação de criação e conclusão', async () => {
  const { repository, service } = setup();
  repository.failAppend = true;
  await assert.rejects(() => createInitial(service), /sheets failure/u);
  repository.failAppend = false;
  await createInitial(service);
  repository.failUpdate = true;
  await assert.rejects(() => service.completeLead(LEAD_ID, qualifiedAnswers), /sheets failure/u);
  assert.equal(repository.rows[0][7], '');
});

test('chave de idempotência evita linha duplicada na criação', async () => {
  const { repository, service } = setup();
  const first = await service.createLead(contact, 'sessão-mini-1');
  const second = await service.createLead(contact, 'sessão-mini-1');
  assert.deepEqual(second, first);
  assert.equal(repository.appendCalls, 1);
  assert.equal(repository.rows.length, 1);
});

test('WhatsApp é bloqueado para desqualificados e liberado para qualificados', async () => {
  const first = setup();
  await createInitial(first.service);
  await first.service.completeLead(LEAD_ID, { ...qualifiedAnswers, investment: 'cannot_invest_now' });
  await assert.rejects(
    () => first.service.registerWhatsAppAccess(LEAD_ID),
    (error) => error.statusCode === 403 && error.code === 'WHATSAPP_NOT_ALLOWED',
  );

  const second = setup();
  await createInitial(second.service);
  await second.service.completeLead(LEAD_ID, qualifiedAnswers);
  const updatesBeforeAccess = second.repository.updateCalls;
  const result = await second.service.registerWhatsAppAccess(LEAD_ID);
  assert.equal(result.link, `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`);
  assert.equal(second.repository.updateCalls, updatesBeforeAccess);
});

test('criação preserva atribuição nas colunas 11 a 18', async () => {
  const { repository, service } = setup();
  await createInitial(service, {
    utmSource: 'facebook', utmMedium: 'paid_social', utmCampaign: 'campanha',
    utmContent: 'criativo-a', utmTerm: 'termo', fbclid: 'fbclid-123',
    entryUrl: 'https://example.com/?utm_source=facebook', device: 'Mobile',
  });
  assert.deepEqual(repository.rows[0].slice(10, 18), [
    'facebook', 'paid_social', 'campanha', 'criativo-a', 'termo', 'fbclid-123',
    'https://example.com/?utm_source=facebook', 'Mobile',
  ]);
});

test('atribuição mantém limites e proteção contra fórmulas', async () => {
  const normalized = normalizeAttribution({
    utmSource: 'a'.repeat(300), fbclid: 'b'.repeat(600), entryUrl: 'c'.repeat(2100), device: 'SmartTV',
  });
  assert.equal(normalized.utmSource.length, 255);
  assert.equal(normalized.fbclid.length, 512);
  assert.equal(normalized.entryUrl.length, 2000);
  assert.equal(normalized.device, '');
  assert.equal(protectSheetText('=IMPORTXML("url")'), "'=IMPORTXML(\"url\")");

  const { repository, service } = setup();
  await createInitial(service, { utmSource: '=IMPORTXML("url")' });
  assert.equal(repository.rows[0][10], "'=IMPORTXML(\"url\")");
});
