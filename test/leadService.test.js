import test from 'node:test';
import assert from 'node:assert/strict';
import { createLeadService, LeadServiceError } from '../server/leadService.js';
import { FORM_CONFIG } from '../public/js/formConfig.js';

const NOW = new Date('2026-10-16T12:00:00.000Z');
const ID = '20000000-0000-4000-8000-000000000002';

function validPayload(overrides = {}) {
  return {
    submissionId: ID,
    privacyNoticeVersion: FORM_CONFIG.privacyNoticeVersion,
    attribution: { utmSource: 'facebook', device: 'Mobile' },
    answers: {
      legalSituation: 'protective_order_received',
      primaryConcern: 'restrictions_and_consequences',
      hiringIntent: 'asap', paymentMethod: 'cash',
      name: '  João  D’Ávila ', phone: '(27) 99999-9999',
      privacyAcknowledged: true, contactConsent: true, ...overrides,
    },
  };
}

function setup() {
  const records = [];
  const repository = {
    records,
    appendCalls: 0,
    async append(record) { this.appendCalls += 1; records.push({ ...record }); },
    async findBySubmissionId(id) {
      const index = records.findIndex((record) => record.submissionId === id);
      return index < 0 ? null : { rowNumber: index + 2, record: { ...records[index] } };
    },
  };
  return { repository, service: createLeadService({ repository, now: () => NOW }) };
}

test('submissão qualificada grava as novas respostas e libera WhatsApp', async () => {
  const { repository, service } = setup();
  const result = await service.submitLead(validPayload(), ID);
  assert.deepEqual([result.leadId, result.completionAction, result.whatsappEligible],
    [ID, 'whatsapp', true]);
  assert.match(repository.records[0].legalSituation, /Preocupação principal: As restrições/u);
  assert.match(repository.records[0].financialAvailability,
    /Capacidade financeira compatível declarada — pagamento à vista.*Condição declarada:/u);
  assert.deepEqual([repository.records[0].name, repository.records[0].phone, repository.records[0].status],
    ['João D’Ávila', '27999999999', 'Qualificado']);
});

test('parcelamento a partir de R$ 500 é capacidade compatível', async () => {
  const { repository, service } = setup();
  await service.submitLead(validPayload({ paymentMethod: 'installments_500' }), ID);
  assert.match(repository.records[0].financialAvailability, /R\$ 500 mensais/u);
  assert.match(repository.records[0].financialAvailability, /parcelas a partir de R\$ 500/u);
});

test('todos os resultados válidos são gravados, mas apenas qualificados recebem WhatsApp', async () => {
  for (const [overrides, status, completionAction] of [
    [{ legalSituation: 'information_only' }, 'Desqualificado', 'none'],
    [{ hiringIntent: 'not_hiring_now' }, 'Desqualificado', 'none'],
    [{ paymentMethod: 'needs_values' }, 'Pendente de qualificação financeira', 'financial_review'],
    [{ paymentMethod: 'not_available' }, 'Desqualificado', 'none'],
  ]) {
    const { repository, service } = setup();
    const result = await service.submitLead(validPayload(overrides), ID);
    assert.deepEqual(
      [result.whatsappEligible, result.whatsappUrl, result.completionAction,
        repository.records[0].status, repository.records[0].priority],
      [false, null, completionAction, status, ''],
    );
    assert.equal(repository.records.length, 1);
  }
});

test('backend rejeita escolhas, contato, campos extras e consentimentos inválidos', async () => {
  for (const [overrides, pattern] of [
    [{ legalSituation: 'forged' }, /legalSituation/u], [{ primaryConcern: 'forged' }, /primaryConcern/u],
    [{ paymentMethod: 'forged' }, /paymentMethod/u], [{ name: '1' }, /nome/u],
    [{ phone: '123' }, /WhatsApp/u], [{ contactConsent: false }, /Autorize/u],
    [{ privacyAcknowledged: false }, /privacidade/u], [{ status: 'Qualificado' }, /Campos de resposta/u],
  ]) {
    const { service } = setup();
    await assert.rejects(() => service.submitLead(validPayload(overrides), ID), pattern);
  }
});

test('Submission ID e chave de idempotência devem coincidir', async () => {
  const { service } = setup();
  await assert.rejects(() => service.submitLead(validPayload(), '30000000-0000-4000-8000-000000000003'),
    (error) => error instanceof LeadServiceError);
});

test('submissões repetidas ou simultâneas criam uma única linha', async () => {
  const { repository, service } = setup();
  const [first, second] = await Promise.all([service.submitLead(validPayload(), ID), service.submitLead(validPayload(), ID)]);
  assert.deepEqual(second, first);
  assert.equal(repository.appendCalls, 1);
  assert.deepEqual(await service.submitLead(validPayload(), ID), first);
  assert.equal(repository.appendCalls, 1);
});

test('protege fórmulas e reconcilia falha após append', async () => {
  const protectedSetup = setup();
  await protectedSetup.service.submitLead(validPayload({ name: '=IMPORTXML("url") Silva' }), ID);
  assert.match(protectedSetup.repository.records[0].name, /^'/u);

  const recovered = setup();
  recovered.repository.append = async function appendThenFail(record) {
    this.records.push({ ...record });
    throw new Error('timeout');
  };
  const result = await recovered.service.submitLead(validPayload(), ID);
  assert.equal(result.leadId, ID);
  assert.equal(recovered.repository.records.length, 1);
});

test('não mascara divergência confirmada na linha gravada', async () => {
  const mismatched = setup();
  mismatched.repository.append = async function appendMisaligned(record) {
    this.records.push({ ...record });
    throw Object.assign(new Error('linha deslocada'), { code: 'SHEETS_WRITE_MISMATCH' });
  };
  await assert.rejects(() => mismatched.service.submitLead(validPayload(), ID),
    (error) => error.code === 'SHEETS_WRITE_MISMATCH');
});
