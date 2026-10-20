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

function createClient({ headers = LEAD_HEADERS, rows, misalignBatchWrite = false } = {}) {
  const calls = [];
  const storedRows = rows ?? [recordToRow(record)];
  return { calls, storedRows, spreadsheets: {
    async get(options) {
      calls.push(['metadata', options]);
      return { data: { sheets: [{ properties: { sheetId: 739700908, title: 'Leads' },
        data: [{ columnMetadata: [{ hiddenByUser: true }] }] }] } };
    },
    async batchUpdate(options) {
      calls.push(['batchUpdate', options]);
      const values = options.requestBody.requests[0].appendCells.rows[0].values
        .map(({ userEnteredValue }) => userEnteredValue.stringValue);
      storedRows.push(misalignBatchWrite ? ['', ...values] : values);
      return { data: { replies: [{}] } };
    },
    values: {
      async append(options) {
        calls.push(['legacyAppend', options]);
        return { data: { tableRange: 'Leads!B1:X5', updates: { updatedRange: 'Leads!B6:Y6' } } };
      },
      async get(options) {
        calls.push(['get', options]);
        if (options.range === "'Leads'!A1:X1") return { data: { values: [headers] } };
        if (options.range === "'Leads'!A2:A") {
          return { data: { values: storedRows.map((row) => [row[0]]) } };
        }
        const fullRow = options.range.match(/^'Leads'!A(\d+):X\1$/u);
        if (fullRow) return { data: { values: [storedRows[Number(fullRow[1]) - 2] ?? []] } };
        const status = options.range.match(/!E(\d+):E\d+$/u);
        return { data: { values: status ? [[storedRows[Number(status[1]) - 2][4]]] : [] } };
      }
    },
  } };
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

test('AppendCells escreve 24 posições desde A mesmo com A oculta e append lógico apontando para B', async () => {
  const client = createClient({ rows: [] });
  const repository = createGoogleSheetsRepository({ environment, sheetsClient: client });
  const result = await repository.append(record);
  const options = client.calls.find(([method]) => method === 'batchUpdate')[1];
  const appendCells = options.requestBody.requests[0].appendCells;
  assert.equal(appendCells.sheetId, 739700908);
  assert.equal(appendCells.fields, 'userEnteredValue');
  assert.equal(appendCells.rows[0].values.length, 24);
  assert.equal(appendCells.rows[0].values[0].userEnteredValue.stringValue, 'id-1');
  assert.equal(appendCells.rows[0].values[2].userEnteredValue.stringValue, 'Pessoa de Teste');
  assert.equal(appendCells.rows[0].values[8].userEnteredValue.stringValue, '');
  assert.equal(result.updatedRange, "'Leads'!A2:X2");
  assert.equal(client.calls.some(([method]) => method === 'legacyAppend'), false);
  assert.deepEqual(client.storedRows[0], recordToRow(record));
});

test('falha sem sucesso silencioso se a releitura não encontrar o ID na coluna A', async () => {
  const client = createClient({ rows: [], misalignBatchWrite: true });
  const repository = createGoogleSheetsRepository({ environment, sheetsClient: client });
  await assert.rejects(() => repository.append(record), (error) => error.code === 'SHEETS_WRITE_MISMATCH');
});

test('appends concorrentes usam linhas distintas sem sobrescrever dados', async () => {
  const client = createClient({ rows: [] });
  const repository = createGoogleSheetsRepository({ environment, sheetsClient: client });
  const second = { ...record, leadId: 'id-2', submissionId: 'id-2', name: 'Segunda Pessoa' };
  await Promise.all([repository.append(record), repository.append(second)]);
  assert.equal(client.storedRows.length, 2);
  assert.deepEqual(client.storedRows.map((row) => row[0]).sort(), ['id-1', 'id-2']);
  assert.deepEqual(client.storedRows.map((row) => row[2]).sort(), ['Pessoa de Teste', 'Segunda Pessoa']);
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
  assert.equal(client.calls.some(([method]) => method === 'batchUpdate'), false);
});

test('aceita credencial JSON em Base64 e rejeita conteúdo inválido', async () => {
  const encoded = Buffer.from(JSON.stringify({
    type: 'service_account',
    client_email: 'service@example.test',
    private_key: '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n',
  })).toString('base64');
  const repository = createGoogleSheetsRepository({
    environment: { GOOGLE_SHEET_ID: 'sheet-id', GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: encoded },
    sheetsClient: createClient(),
  });
  assert.equal(await repository.verifyConnection(), true);
  await assert.rejects(
    () => createGoogleSheetsRepository({
      environment: { GOOGLE_SHEET_ID: 'sheet-id', GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: 'invalid' },
      sheetsClient: createClient(),
    }).verifyConnection(),
    (error) => error.code === 'SHEETS_CONFIG_INVALID',
  );
});

test('valida o cabeçalho uma única vez por instância', async () => {
  const client = createClient({ rows: [] });
  const repository = createGoogleSheetsRepository({ environment, sheetsClient: client });
  await repository.verifyConnection();
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
  assert.equal(client.calls.some(([method]) => method === 'batchUpdate'), false);
});
