import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLUMN_COUNT, createLeadService, normalizeAttribution, protectSheetText,
} from '../server/leadService.js';
import { WHATSAPP_MESSAGE, WHATSAPP_NUMBER } from '../public/js/whatsapp.js';

const FIXED_DATE = new Date('2026-09-18T12:00:00.000Z');
const LEAD_ID = '10000000-0000-4000-8000-000000000001';

const personal = {
  name: '  Ana   Lúcia ',
  phone: '(27) 99873-7944',
  email: ' ANA@EXEMPLO.COM ',
};

const qualifiedAnswers = {
  ...personal,
  situation: 'protective_measure_received',
  income: 'from_6000_to_10000',
  pensionRange: 'from_500_to_1500',
  urgency: 'deadline_48h',
  hiring: 'ready_to_hire',
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
  return service.createLead({ ...personal, ...extra });
}

test('cria lead inicial com dados normalizados e exatamente 23 colunas', async () => {
  const { repository, service } = setup();
  const result = await createInitial(service);
  assert.deepEqual(result, { leadId: LEAD_ID, status: 'Em preenchimento' });
  assert.equal(repository.rows.length, 1);
  assert.equal(COLUMN_COUNT, 23);
  assert.equal(repository.rows[0].length, 23);
  assert.equal(repository.rows[0][1], FIXED_DATE.toISOString());
  assert.equal(repository.rows[0][3], 'Ana Lúcia');
  assert.equal(repository.rows[0][4], '27998737944');
  assert.equal(repository.rows[0][5], 'ana@exemplo.com');
  assert.equal(repository.rows[0][12], '');
});

test('serializa posições críticas sem permitir retorno do schema antigo', async () => {
  const { repository, service } = setup();
  const tracking = {
    utmSource: 'meta',
    utmMedium: 'paid_social',
    utmCampaign: 'defesa',
    utmContent: 'video-1',
    utmTerm: 'advogada',
    fbclid: 'fbclid-critical',
    entryUrl: 'https://example.com/?utm_source=meta',
    device: 'Desktop',
  };
  await service.createLead({
    name: 'Sales Fuel',
    phone: '32243243432',
    email: 'assessoriasalesfuel@gmail.com',
    ...tracking,
  });

  let row = repository.rows[0];
  assert.equal(row.length, 23);
  assert.equal(row[0], LEAD_ID);
  assert.equal(row[1], FIXED_DATE.toISOString());
  assert.equal(row[2], 'Em preenchimento');
  assert.equal(row[3], 'Sales Fuel');
  assert.equal(row[4], '32243243432');
  assert.equal(row[5], 'assessoriasalesfuel@gmail.com');
  assert.deepEqual(row.slice(6, 15), Array(9).fill(''));
  assert.deepEqual(row.slice(15, 23), Object.values(tracking));
  assert.notEqual(row[3], 'urgente');

  await service.completeLead(LEAD_ID, {
    name: 'Sales Fuel',
    phone: '32243243432',
    email: 'assessoriasalesfuel@gmail.com',
    situation: 'protective_measure_received',
    income: 'from_6000_to_10000',
    pensionRange: 'from_500_to_1500',
    urgency: 'deadline_48h',
    hiring: 'ready_to_hire',
    dataConsent: true,
    contactConsent: true,
  });

  row = repository.rows[0];
  assert.equal(row.length, 23);
  assert.deepEqual(row.slice(2, 11), [
    'Qualificado',
    'Sales Fuel',
    '32243243432',
    'assessoriasalesfuel@gmail.com',
    'Já recebi uma medida protetiva.',
    'De R$ 6.001 a R$ 10.000.',
    'De R$ 500 a R$ 1.500',
    'Tenho audiência ou prazo nas próximas 48 horas.',
    'Estou preparado para contratar e quero resolver isso agora.',
  ]);
  assert.equal(typeof row[11], 'string');
  assert.notEqual(row[11], '');
  assert.equal(row[12], FIXED_DATE.toISOString());
  assert.equal(row[13], 'Sim');
  assert.equal(row[14], 'Sim');
  assert.deepEqual(row.slice(15, 23), Object.values(tracking));
});

test('gera Lead ID com randomUUID por padrão', async () => {
  const repository = createRepository();
  const service = createLeadService({ repository, now: () => FIXED_DATE });
  const result = await createInitial(service);
  assert.match(result.leadId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
});

test('rejeita dados pessoais inválidos no servidor', async () => {
  const { service } = setup();
  await assert.rejects(() => createInitial(service, { phone: '123' }), /WhatsApp/u);
  await assert.rejects(() => createInitial(service, { email: 'inválido' }), /e-mail/u);
  await assert.rejects(() => createInitial(service, { name: '12' }), /nome/u);
});

test('atualiza a mesma linha pelo Lead ID', async () => {
  const { repository, service } = setup();
  await createInitial(service);
  await service.updateLead(LEAD_ID, { situation: 'helping_family' });
  assert.equal(repository.rows.length, 1);
  assert.equal(repository.rows[0].length, 23);
  assert.equal(repository.rows[0][6], 'Estou buscando ajuda para um familiar.');
});

test('aceita e persiste exatamente as quatro faixas de pensão alimentícia', async () => {
  const options = [
    ['not_paying', 'Não pago pensão atualmente'],
    ['up_to_500', 'Até R$ 500'],
    ['from_500_to_1500', 'De R$ 500 a R$ 1.500'],
    ['above_1500', 'Acima de R$ 1.500'],
  ];
  for (const [value, label] of options) {
    const { repository, service } = setup();
    await createInitial(service);
    await service.updateLead(LEAD_ID, { pensionRange: value });
    assert.equal(repository.rows[0][8], label);
  }
});

test('retorna erro para Lead ID inexistente', async () => {
  const { service } = setup();
  await assert.rejects(
    () => service.updateLead('inexistente', { situation: 'helping_family' }),
    (error) => error.statusCode === 404 && error.code === 'LEAD_NOT_FOUND',
  );
});

test('rejeita payload vazio, campo proibido e opção inválida', async () => {
  const { service } = setup();
  await createInitial(service);
  await assert.rejects(() => service.updateLead(LEAD_ID, {}), /Payload/u);
  await assert.rejects(() => service.updateLead(LEAD_ID, { status: 'Qualificado' }), /Payload/u);
  await assert.rejects(() => service.updateLead(LEAD_ID, { urgency: 'inventada' }), /urgency/u);
  await assert.rejects(() => service.updateLead(LEAD_ID, { pensionRange: 'inventada' }), /pensionRange/u);
});

test('recalcula classificação no servidor sem retornar prioridade no contrato', async () => {
  const { service } = setup();
  await createInitial(service);
  const result = await service.completeLead(LEAD_ID, qualifiedAnswers);
  assert.equal(result.classification, 'qualified');
  assert.equal(result.qualified, true);
  assert.equal('priority' in result, false);
});

test('ignora classificação, prioridade e motivo enviados pelo cliente', async () => {
  const { repository, service } = setup();
  await createInitial(service);
  await service.completeLead(LEAD_ID, {
    ...qualifiedAnswers,
    classification: 'disqualified',
    priority: 'normal',
    reason: 'forçado',
  });
  assert.equal(repository.rows[0][2], 'Qualificado');
  assert.notEqual(repository.rows[0][11], 'forçado');
});

test('conclui lead qualificado e persiste campos finais', async () => {
  const { repository, service } = setup();
  await createInitial(service);
  await service.completeLead(LEAD_ID, qualifiedAnswers);
  const row = repository.rows[0];
  assert.equal(row[2], 'Qualificado');
  assert.equal(row[12], FIXED_DATE.toISOString());
  assert.equal(row[13], 'Sim');
  assert.equal(row[14], 'Sim');
  assert.equal(row.filter((value) => value === FIXED_DATE.toISOString()).length, 2);
});

test('data de conclusão é gerada no servidor e ignora valor enviado pelo cliente', async () => {
  const { repository, service } = setup();
  await createInitial(service);
  await service.completeLead(LEAD_ID, {
    ...qualifiedAnswers,
    completedAt: '2000-01-01T00:00:00.000Z',
    completionDate: '2001-01-01T00:00:00.000Z',
  });
  assert.equal(repository.rows[0][12], FIXED_DATE.toISOString());
});

test('conclui lead desqualificado conforme regras existentes', async () => {
  const { repository, service } = setup();
  await createInitial(service);
  const result = await service.completeLead(LEAD_ID, { ...qualifiedAnswers, hiring: 'free_only' });
  assert.equal(result.qualified, false);
  assert.equal(repository.rows[0][2], 'Desqualificado');
});

test('falha do Sheets impede confirmação de criação e conclusão', async () => {
  const { repository, service } = setup();
  repository.failAppend = true;
  await assert.rejects(() => createInitial(service), /sheets failure/u);
  repository.failAppend = false;
  await createInitial(service);
  repository.failUpdate = true;
  await assert.rejects(() => service.completeLead(LEAD_ID, qualifiedAnswers), /sheets failure/u);
  assert.equal(repository.rows[0][12], '');
});

test('bloqueia WhatsApp para lead desqualificado', async () => {
  const { service } = setup();
  await createInitial(service);
  await service.completeLead(LEAD_ID, { ...qualifiedAnswers, situation: 'other_situation' });
  await assert.rejects(
    () => service.registerWhatsAppAccess(LEAD_ID),
    (error) => error.statusCode === 403 && error.code === 'WHATSAPP_NOT_ALLOWED',
  );
});

test('libera o link correto somente para lead qualificado concluído', async () => {
  const { service } = setup();
  await createInitial(service);
  await service.completeLead(LEAD_ID, qualifiedAnswers);
  const result = await service.registerWhatsAppAccess(LEAD_ID);
  assert.equal(result.link, `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`);
});

test('acesso ao WhatsApp não escreve no Sheets', async () => {
  const { repository, service } = setup();
  await createInitial(service);
  await service.completeLead(LEAD_ID, qualifiedAnswers);
  const updatesBeforeAccess = repository.updateCalls;
  await service.registerWhatsAppAccess(LEAD_ID);
  assert.equal(repository.updateCalls, updatesBeforeAccess);
});

test('registro repetido do WhatsApp é idempotente', async () => {
  const { repository, service } = setup();
  await createInitial(service);
  await service.completeLead(LEAD_ID, qualifiedAnswers);
  await service.registerWhatsAppAccess(LEAD_ID);
  const updatesAfterFirstAccess = repository.updateCalls;
  await service.registerWhatsAppAccess(LEAD_ID);
  assert.equal(repository.updateCalls, updatesAfterFirstAccess);
  assert.equal(repository.rows.length, 1);
});

test('chave de idempotência evita linha duplicada na criação', async () => {
  const { repository, service } = setup();
  const first = await service.createLead(personal, 'sessão-1');
  const second = await service.createLead(personal, 'sessão-1');
  assert.deepEqual(second, first);
  assert.equal(repository.appendCalls, 1);
  assert.equal(repository.rows.length, 1);
});

test('conclusão repetida atualiza a mesma linha sem duplicar', async () => {
  let currentTime = FIXED_DATE;
  const { repository, service } = setup({ now: () => currentTime });
  await createInitial(service);
  currentTime = new Date('2026-09-18T12:05:00.000Z');
  await service.completeLead(LEAD_ID, qualifiedAnswers);
  currentTime = new Date('2026-09-18T12:10:00.000Z');
  await service.completeLead(LEAD_ID, qualifiedAnswers);
  assert.equal(repository.appendCalls, 1);
  assert.equal(repository.rows.length, 1);
  assert.equal(repository.rows[0][12], '2026-09-18T12:05:00.000Z');
});

test('protege textos iniciados por operadores de fórmula', async () => {
  assert.equal(protectSheetText('=SUM(A1:A2)'), "'=SUM(A1:A2)");
  assert.equal(protectSheetText('+comando'), "'+comando");
  assert.equal(protectSheetText('-comando'), "'-comando");
  assert.equal(protectSheetText('@comando'), "'@comando");
  const { repository, service } = setup();
  await createInitial(service, { name: '=Ana' });
  assert.equal(repository.rows[0][3], "'=Ana");
});

test('criação persiste os oito campos de atribuição nas colunas 16 a 23', async () => {
  const { repository, service } = setup();
  await createInitial(service, {
    utmSource: 'facebook',
    utmMedium: 'paid_social',
    utmCampaign: 'campanha',
    utmContent: 'criativo-a',
    utmTerm: 'termo',
    fbclid: 'fbclid-123',
    entryUrl: 'https://example.com/?utm_source=facebook',
    device: 'Mobile',
  });
  assert.deepEqual(repository.rows[0].slice(15, 23), [
    'facebook', 'paid_social', 'campanha', 'criativo-a', 'termo', 'fbclid-123',
    'https://example.com/?utm_source=facebook', 'Mobile',
  ]);
});

test('ausência de UTMs não impede a criação', async () => {
  const { repository, service } = setup();
  await createInitial(service);
  assert.equal(repository.rows.length, 1);
  assert.deepEqual(repository.rows[0].slice(15, 23), Array(8).fill(''));
});

test('protege atribuição contra formula injection', async () => {
  const { repository, service } = setup();
  await createInitial(service, { utmSource: '=IMPORTXML("url")', utmCampaign: '+comando' });
  assert.equal(repository.rows[0][15], "'=IMPORTXML(\"url\")");
  assert.equal(repository.rows[0][17], "'+comando");
});

test('trunca campos de atribuição nos limites definidos', () => {
  const normalized = normalizeAttribution({
    utmSource: 'a'.repeat(300),
    fbclid: 'b'.repeat(600),
    entryUrl: 'c'.repeat(2100),
    device: 'SmartTV',
  });
  assert.equal(normalized.utmSource.length, 255);
  assert.equal(normalized.fbclid.length, 512);
  assert.equal(normalized.entryUrl.length, 2000);
  assert.equal('referrer' in normalized, false);
  assert.equal(normalized.device, '');
});

test('rejeita campos desconhecidos na criação', async () => {
  const { service } = setup();
  await assert.rejects(() => createInitial(service, { unknownTracking: 'value' }), /criação inválido/u);
  await assert.rejects(() => createInitial(service, { lastStep: 'email' }), /criação inválido/u);
  await assert.rejects(() => createInitial(service, { referrer: 'https://example.com/' }), /criação inválido/u);
});

test('PATCH rejeita lastStep e campos removidos', async () => {
  const { service } = setup();
  await createInitial(service);
  await assert.rejects(() => service.updateLead(LEAD_ID, { lastStep: 'situation' }), /atualização inválido/u);
  await assert.rejects(() => service.updateLead(LEAD_ID, { priority: 'urgent' }), /atualização inválido/u);
});

test('persiste rótulos legíveis sem alterar atribuição ausente', async () => {
  const { repository, service } = setup();
  await createInitial(service);
  await service.completeLead(LEAD_ID, qualifiedAnswers);
  const row = repository.rows[0];
  assert.equal(row[6], 'Já recebi uma medida protetiva.');
  assert.equal(row[7], 'De R$ 6.001 a R$ 10.000.');
  assert.equal(row[8], 'De R$ 500 a R$ 1.500');
  assert.equal(row[9], 'Tenho audiência ou prazo nas próximas 48 horas.');
  assert.equal(row[10], 'Estou preparado para contratar e quero resolver isso agora.');
  assert.deepEqual(row.slice(15, 23), Array(8).fill(''));
});

test('exige os dois consentimentos na conclusão', async () => {
  const { service } = setup();
  await createInitial(service);
  await assert.rejects(
    () => service.completeLead(LEAD_ID, { ...qualifiedAnswers, contactConsent: false }),
    /confirmações/u,
  );
});
