import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleSheetsRepository, GoogleSheetsError } from '../server/googleSheets.js';
import { COLUMN_COUNT, LEAD_HEADERS } from '../server/leadSchema.js';

const environment = {
  GOOGLE_SHEET_ID: 'sheet-id',
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'service@example.test',
  GOOGLE_PRIVATE_KEY: 'line-1\\nline-2',
};

function leadRow(id) {
  const row = Array(COLUMN_COUNT).fill('');
  row[0] = id;
  return row;
}

function createClient({ headers = LEAD_HEADERS } = {}) {
  const calls = [];
  return {
    calls,
    spreadsheets: {
      values: {
        async append(options) {
          calls.push(['append', options]);
          return { data: { updates: { updatedRows: 1 } } };
        },
        async get(options) {
          calls.push(['get', options]);
          if (options.range === "'Leads'!A1:W1") return { data: { values: [headers] } };
          return { data: { values: [['id-1', 'A'], ['id-2', 'B']] } };
        },
        async update(options) {
          calls.push(['update', options]);
          return { data: { updatedRows: 1 } };
        },
      },
    },
  };
}

test('repositório do Sheets usa escrita RAW e somente a aba Leads', async () => {
  const client = createClient();
  const repository = createGoogleSheetsRepository({ environment, sheetsClient: client });
  const row = leadRow('id-1');
  row[1] = '=literal';
  await repository.append(row);
  const options = client.calls.find(([method]) => method === 'append')[1];
  assert.equal(options.spreadsheetId, 'sheet-id');
  assert.equal(options.range, "'Leads'!A2:W");
  assert.equal(options.valueInputOption, 'RAW');
});

test('localiza linha por Lead ID sem aceitar índice do cliente', async () => {
  const repository = createGoogleSheetsRepository({ environment, sheetsClient: createClient() });
  const result = await repository.findByLeadId('id-2');
  assert.equal(result.rowNumber, 3);
  assert.equal(result.row.length, 23);
  assert.deepEqual(result.row.slice(0, 2), ['id-2', 'B']);
  assert.equal(await repository.findByLeadId('ausente'), null);
});

test('atualiza a faixa correspondente à linha localizada', async () => {
  const client = createClient();
  const repository = createGoogleSheetsRepository({ environment, sheetsClient: client });
  await repository.update(7, leadRow('id-7'));
  const options = client.calls.find(([method]) => method === 'update')[1];
  assert.equal(options.range, "'Leads'!A7:W7");
  assert.equal(options.valueInputOption, 'RAW');
});

test('rejeita configuração ausente sem expor credenciais', async () => {
  const repository = createGoogleSheetsRepository({ environment: {}, sheetsClient: createClient() });
  await assert.rejects(
    () => repository.append(leadRow('id')),
    (error) => error instanceof GoogleSheetsError && error.code === 'SHEETS_UNAVAILABLE',
  );
});

test('bloqueia qualquer escrita quando o cabeçalho não corresponde ao schema A:W', async () => {
  const headers = [...LEAD_HEADERS];
  headers[3] = 'Prioridade';
  const client = createClient({ headers });
  const repository = createGoogleSheetsRepository({ environment, sheetsClient: client });
  await assert.rejects(
    () => repository.append(leadRow('id-1')),
    (error) => error instanceof GoogleSheetsError && error.code === 'SHEETS_SCHEMA_MISMATCH',
  );
  assert.equal(client.calls.some(([method]) => method === 'append'), false);
});

test('append e update rejeitam arrays diferentes de 23 células antes da escrita', async () => {
  const client = createClient();
  const repository = createGoogleSheetsRepository({ environment, sheetsClient: client });
  await assert.rejects(() => repository.append(Array(30).fill('')), GoogleSheetsError);
  await assert.rejects(() => repository.update(2, Array(22).fill('')), GoogleSheetsError);
  assert.equal(client.calls.some(([method]) => method === 'append' || method === 'update'), false);
});

test('valida o cabeçalho uma vez e reutiliza o resultado em operações posteriores', async () => {
  const client = createClient();
  const repository = createGoogleSheetsRepository({ environment, sheetsClient: client });
  await repository.append(leadRow('id-1'));
  await repository.update(2, leadRow('id-1'));
  const headerReads = client.calls.filter(([, options]) => options.range === "'Leads'!A1:W1");
  assert.equal(headerReads.length, 1);
});
