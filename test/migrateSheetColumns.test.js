import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FINAL_HEADERS, INCOME_HEADERS, OLD_HEADERS, PREVIOUS_HEADERS, REMOVED_HEADERS, identifyHeaderVersion,
  runMigration, transformLeadValues,
} from '../scripts/migrateSheetColumns.js';

const environment = {
  GOOGLE_SHEET_ID: '1zzeazzXlD3XI1ZnTQoO9MX27DvqHlionTDPqhHA5UEA',
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'migration@example.test',
  GOOGLE_PRIVATE_KEY: 'line-1\\nline-2',
};

function metadataSheet(title, sheetId, migrated = false) {
  return {
    properties: {
      title,
      sheetId,
      gridProperties: { rowCount: 100, columnCount: title === 'Visão geral' ? 10 : migrated ? 23 : 30 },
    },
    conditionalFormats: title === 'Visão geral' ? [] : [
      { ranges: [{ sheetId, startColumnIndex: 3, endColumnIndex: 4 }], booleanRule: { condition: { values: [{ userEnteredValue: 'urgent' }] } } },
      { ranges: [{ sheetId, startColumnIndex: 0, endColumnIndex: 30 }], booleanRule: { condition: { values: [{ userEnteredValue: 'Qualificado' }] } } },
    ],
  };
}

function createSheetsClient({ initialHeaders = OLD_HEADERS, initialColumnCount = 30 } = {}) {
  const calls = { batchUpdates: [] };
  const sampleRow = initialHeaders.map((header) => `${header}-valor`);
  return {
    calls,
    spreadsheets: {
      async get() {
        const migrated = calls.batchUpdates.length > 0;
        return {
          data: {
            sheets: [
              { ...metadataSheet('Leads', 1, migrated), properties: { ...metadataSheet('Leads', 1, migrated).properties, gridProperties: { rowCount: 100, columnCount: migrated ? 23 : initialColumnCount } } },
              { ...metadataSheet('Qualificados', 2, migrated), properties: { ...metadataSheet('Qualificados', 2, migrated).properties, gridProperties: { rowCount: 100, columnCount: migrated ? 23 : initialColumnCount } } },
              { ...metadataSheet('Desqualificados', 3, migrated), properties: { ...metadataSheet('Desqualificados', 3, migrated).properties, gridProperties: { rowCount: 100, columnCount: migrated ? 23 : initialColumnCount } } },
              metadataSheet('Visão geral', 4),
            ],
          },
        };
      },
      values: {
        async batchGet() {
          if (calls.batchUpdates.length > 0) {
            return {
              data: {
                valueRanges: [
                  { values: [FINAL_HEADERS] },
                  { values: [FINAL_HEADERS] },
                  { values: [FINAL_HEADERS] },
                  { values: [[`=IFERROR(QUERY(INDIRECT("Leads!A2:W");"select * where C = 'Qualificado'";0);"")`]] },
                  { values: [[`=IFERROR(QUERY(INDIRECT("Leads!A2:W");"select * where C = 'Desqualificado'";0);"")`]] },
                ],
              },
            };
          }
          return {
            data: {
              valueRanges: [
                { values: [initialHeaders, sampleRow] },
                { values: [initialHeaders] },
                { values: [initialHeaders] },
                { values: [['Total de leads', '=COUNTA(Leads!A2:A)'], ['Qualificados', '=COUNTIF(Leads!C:C;"Qualificado")']] },
              ],
            },
          };
        },
      },
      async batchUpdate(options) {
        calls.batchUpdates.push(options);
        return { data: {} };
      },
    },
  };
}

test('modelo final possui exatamente as 23 colunas aprovadas', () => {
  assert.equal(FINAL_HEADERS.length, 23);
  assert.deepEqual(FINAL_HEADERS, [
    'Lead ID', 'Data de criação', 'Status', 'Nome', 'WhatsApp', 'E-mail', 'Situação atual',
    'Faixa de renda', 'Faixa de pensão alimentícia', 'Urgência', 'Momento da contratação',
    'Motivo da classificação', 'Data de conclusão',
    'Consentimento de dados', 'Autorização de contato', 'UTM Source', 'UTM Medium', 'UTM Campaign',
    'UTM Content', 'UTM Term', 'FBCLID', 'URL de entrada', 'Dispositivo',
  ]);
});

test('modelo final exclui os cabeçalhos legados', () => {
  assert.deepEqual(REMOVED_HEADERS, [
    'Prioridade', 'DDD', 'Principal preocupação', 'Última etapa', 'Última atualização', 'WhatsApp acessado',
    'Data do acesso ao WhatsApp', 'Data do consentimento', 'Referrer',
  ]);
  REMOVED_HEADERS.forEach((header) => assert.equal(FINAL_HEADERS.includes(header), false));
});

test('transformação usa nomes dos cabeçalhos e preserva Lead ID', () => {
  const shuffled = [...OLD_HEADERS].reverse();
  const row = shuffled.map((header) => `${header}-valor`);
  const transformed = transformLeadValues([shuffled, row]);
  assert.deepEqual(transformed[0], FINAL_HEADERS);
  assert.equal(transformed[1][0], 'Lead ID-valor');
  assert.equal(transformed[1][3], 'Nome-valor');
  assert.equal(transformed[1][8], '');
  assert.equal(transformed[1][12], 'Data de conclusão-valor');
  assert.equal(transformed[1].length, 23);
});

test('estrutura final de 23 colunas é reconhecida e transformada de forma idempotente', () => {
  assert.equal(identifyHeaderVersion(FINAL_HEADERS), 'final');
  const finalRow = FINAL_HEADERS.map((header) => `${header}-valor`);
  assert.deepEqual(transformLeadValues([FINAL_HEADERS, finalRow]), [FINAL_HEADERS, finalRow]);
});

test('estrutura anterior de 22 colunas é reconhecida e inicia renda vazia', () => {
  assert.equal(identifyHeaderVersion(PREVIOUS_HEADERS), 'previous');
  const previousRow = PREVIOUS_HEADERS.map((header) => `${header}-valor`);
  const transformed = transformLeadValues([PREVIOUS_HEADERS, previousRow]);
  assert.equal(transformed[1][7], '');
  assert.equal(transformed[1][8], '');
  assert.equal(transformed[1][9], 'Urgência-valor');
});

test('estrutura de 22 colunas com renda preserva dados e inicia pensão vazia', () => {
  assert.equal(identifyHeaderVersion(INCOME_HEADERS), 'income');
  const row = INCOME_HEADERS.map((header) => `${header}-valor`);
  const transformed = transformLeadValues([INCOME_HEADERS, row]);
  assert.equal(transformed[1][7], 'Faixa de renda-valor');
  assert.equal(transformed[1][8], '');
  assert.equal(transformed[1][9], 'Urgência-valor');
});

test('migração aborta quando cabeçalhos estão incompletos', () => {
  assert.throws(() => identifyHeaderVersion(OLD_HEADERS.slice(0, -1)), /cabeçalhos/u);
});

test('migração real é bloqueada sem confirmação explícita', async () => {
  const sheetsClient = createSheetsClient();
  await assert.rejects(
    () => runMigration({ environment, sheetsClient }),
    /CONFIRM_SHEET_MIGRATION=true/u,
  );
  assert.equal(sheetsClient.calls.batchUpdates.length, 0);
});

test('dry-run valida e transforma sem escrever', async () => {
  const sheetsClient = createSheetsClient();
  const summary = await runMigration({ dryRun: true, environment, sheetsClient });
  assert.equal(summary.rows, 1);
  assert.equal(summary.currentColumns, 30);
  assert.equal(summary.finalColumns, 23);
  assert.deepEqual(summary.removedHeaders, REMOVED_HEADERS);
  assert.equal(sheetsClient.calls.batchUpdates.length, 0);
});

test('migração confirmada prepara fórmulas, filtros e remoção física das colunas excedentes', async () => {
  const sheetsClient = createSheetsClient();
  const result = await runMigration({
    environment: { ...environment, CONFIRM_SHEET_MIGRATION: 'true' },
    sheetsClient,
  });
  assert.equal(result.migrated, true);
  assert.equal(sheetsClient.calls.batchUpdates.length, 1);
  const requests = sheetsClient.calls.batchUpdates[0].requestBody.requests;
  assert.equal(requests.filter((request) => request.deleteDimension).length, 3);
  assert.equal(requests.filter((request) => request.setBasicFilter).length, 3);
  assert.equal(requests.filter((request) => request.deleteConditionalFormatRule).length, 3);
  assert.equal(JSON.stringify(requests).includes('"sheetId":4'), false);
  const formulas = requests
    .filter((request) => request.updateCells?.rows?.[0]?.values?.[0]?.userEnteredValue?.formulaValue)
    .map((request) => request.updateCells.rows[0].values[0].userEnteredValue.formulaValue);
  assert.deepEqual(formulas, [
    `=IFERROR(QUERY(INDIRECT("Leads!A2:W");"select * where C = 'Qualificado'";0);"")`,
    `=IFERROR(QUERY(INDIRECT("Leads!A2:W");"select * where C = 'Desqualificado'";0);"")`,
  ]);
});

test('migração de A:V adiciona uma coluna e não desloca dados existentes', async () => {
  const sheetsClient = createSheetsClient({ initialHeaders: INCOME_HEADERS, initialColumnCount: 22 });
  await runMigration({
    environment: { ...environment, CONFIRM_SHEET_MIGRATION: 'true' },
    sheetsClient,
  });
  const requests = sheetsClient.calls.batchUpdates[0].requestBody.requests;
  assert.equal(requests.filter((request) => request.appendDimension).length, 3);
  assert.equal(requests.filter((request) => request.deleteDimension).length, 0);
  const leadsWrite = requests.find((request) => request.updateCells?.range?.sheetId === 1);
  const values = leadsWrite.updateCells.rows[1].values.map(({ userEnteredValue }) => userEnteredValue.stringValue);
  assert.equal(values[7], 'Faixa de renda-valor');
  assert.equal(values[8], '');
  assert.equal(values[9], 'Urgência-valor');
  assert.equal(values[22], 'Dispositivo-valor');
});
