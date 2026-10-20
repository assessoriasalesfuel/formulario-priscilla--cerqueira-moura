import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGoogleSheetsRepository, formatCrmDate, GoogleSheetsError, recordToRow,
} from '../server/googleSheets.js';
import { LEAD_HEADERS } from '../server/leadSchema.js';

const environment = {
  GOOGLE_SHEET_ID: 'sheet-id',
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'service@example.test',
  GOOGLE_PRIVATE_KEY: 'key',
};
const record = {
  leadId: 'id-1', submissionId: 'id-1', createdAt: new Date('2026-10-17T12:00:00Z'),
  name: 'Pessoa de Teste', phone: '27999999999', status: 'Qualificado', priority: 'Alta',
  operationalUrgency: 'Alta', legalSituation: 'Situação | Preocupação principal: Restrições',
  caseAwarenessTime: '', lawyerSituation: '',
  hiringIntent: 'Quero contratar uma advogada o quanto antes.', financialAvailability: 'Sim | À vista',
  classificationReason: 'Motivo', contactConsent: 'Sim',
  privacyAcknowledged: 'Sim', privacyNoticeVersion: 'v1', utmSource: 'facebook', fbclid: 'fb-id',
  entryUrl: 'https://example.test/formulario', device: 'Mobile',
};

function createClient({ headers = LEAD_HEADERS, rows } = {}) {
  const calls = [];
  const storedRows = rows ?? [recordToRow(record)];
  return { calls, spreadsheets: { values: {
    async append(options) { calls.push(['append', options]); return { data: { updates: { updatedRows: 1 } } }; },
    async get(options) {
      calls.push(['get', options]);
      if (options.range === "'Leads'!A1:X1") return { data: { values: [headers] } };
      if (options.range === "'Leads'!A2:A") {
        return { data: { values: storedRows.map((row) => [row[0]]) } };
      }
      const match = options.range.match(/!E(\d+):E\d+$/u);
      return { data: { values: match ? [[storedRows[Number(match[1]) - 2][4]]] : [] } };
    },
  } } };
}

test('mapeia individualmente A:X e preserva vazios e metadados', () => {
  const row = recordToRow(record);
  assert.deepEqual(row, [
    'id-1', '17/10/2026 09:00', 'Pessoa de Teste', '27999999999', 'Qualificado', 'Alta',
    'Alta', 'Situação | Preocupação principal: Restrições', '', '',
    'Quero contratar uma advogada o quanto antes.', 'Sim | À vista',
    'Motivo', 'Sim', 'Sim', 'v1', 'facebook', '', '', '', '', 'fb-id',
    'https://example.test/formulario', 'Mobile',
  ]);
  assert.equal(formatCrmDate('2026-10-17T02:30:00.000Z'), '16/10/2026 23:30');
});

test('mantém todas as posições quando campos opcionais estão vazios', () => {
  const row = recordToRow({
    ...record,
    priority: '', operationalUrgency: '', caseAwarenessTime: '', lawyerSituation: '',
    utmSource: '', utmMedium: '', utmCampaign: '', utmContent: '', utmTerm: '', fbclid: '',
    entryUrl: '', device: '',
  });
  assert.equal(row.length, 24);
  assert.equal(row[2], 'Pessoa de Teste');
  assert.equal(row[3], '27999999999');
  assert.equal(row[4], 'Qualificado');
  assert.equal(row[7], 'Situação | Preocupação principal: Restrições');
  assert.equal(row[8], '');
  assert.equal(row[9], '');
  assert.equal(row[10], 'Quero contratar uma advogada o quanto antes.');
  assert.deepEqual(row.slice(16, 24), Array(8).fill(''));
});

test('repositório ancora append no cabeçalho A:X e envia 24 posições fixas', async () => {
  const client = createClient();
  const repository = createGoogleSheetsRepository({ environment, sheetsClient: client });
  await repository.append(record);
  const options = client.calls.find(([method]) => method === 'append')[1];
  assert.equal(options.range, "'Leads'!A1:X1");
  assert.equal(options.valueInputOption, 'RAW');
  assert.equal(options.requestBody.values[0].length, 24);
});

test('localiza submissão e recupera os dados necessários à idempotência', async () => {
  const client = createClient();
  const repository = createGoogleSheetsRepository({ environment, sheetsClient: client });
  const match = await repository.findBySubmissionId('id-1');
  assert.deepEqual(match.record, {
    leadId: 'id-1', submissionId: 'id-1', status: 'Qualificado',
  });
  assert.equal(await repository.findBySubmissionId('ausente'), null);
  assert.ok(client.calls.some(([, options]) => options.range === "'Leads'!A2:A"));
  assert.ok(client.calls.some(([, options]) => options.range === "'Leads'!E2:E2"));
  assert.equal(client.calls.some(([, options]) => options.range === "'Leads'!A2:X"), false);
});

test('configuração ausente e schema divergente bloqueiam acesso', async () => {
  await assert.rejects(
    () => createGoogleSheetsRepository({ environment: {}, sheetsClient: createClient() }).append(record),
    GoogleSheetsError,
  );
  const headers = [...LEAD_HEADERS]; headers[3] = 'Divergente';
  const client = createClient({ headers });
  await assert.rejects(
    () => createGoogleSheetsRepository({ environment, sheetsClient: client }).append(record),
    (error) => error.code === 'SHEETS_SCHEMA_MISMATCH',
  );
  assert.equal(client.calls.some(([method]) => method === 'append'), false);
});

test('valida o cabeçalho uma única vez por instância', async () => {
  const client = createClient();
  const repository = createGoogleSheetsRepository({ environment, sheetsClient: client });
  await repository.findBySubmissionId('id-1');
  await repository.append(record);
  assert.equal(client.calls.filter(([method, options]) => method === 'get'
    && options.range === "'Leads'!A1:X1").length, 1);
});

test('verifica a conexão somente por leitura e reutiliza a validação do schema', async () => {
  const client = createClient();
  const repository = createGoogleSheetsRepository({ environment, sheetsClient: client });
  assert.equal(await repository.verifyConnection(), true);
  assert.equal(await repository.verifyConnection(), true);
  assert.equal(client.calls.filter(([method, options]) => method === 'get'
    && options.range === "'Leads'!A1:X1").length, 1);
  assert.equal(client.calls.some(([method]) => method === 'append'), false);
});
