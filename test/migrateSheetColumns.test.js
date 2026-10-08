import test from 'node:test';
import assert from 'node:assert/strict';
import { LEAD_HEADERS } from '../server/leadSchema.js';
import { DERIVED_VIEW_FORMULAS } from '../server/sheetViewFormulas.js';
import {
  FINAL_HEADERS,
  LEGACY_HEADERS,
  identifyHeaderVersion,
  runMigration,
  transformLeadValues,
  validateSafetySnapshots,
} from '../scripts/migrateSheetColumns.js';

const PROD_ID = '1zzeazzXlD3XI1ZnTQoO9MX27DvqHlionTDPqhHA5UEA';
const BACKUP_ID = 'backup-sheet-id';
const environment = {
  GOOGLE_SHEET_ID: PROD_ID,
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'migration@example.test',
  GOOGLE_PRIVATE_KEY: 'line-1\\nline-2',
};

const dashboard = [
  ['CRM — Dra. Priscilla Cerqueira Moura'], [], [], [],
  ['Total de leads', '', '', '', '', 'Qualificados'],
  ['=COUNTA(Leads!A2:A)', '', '', '', '', '=COUNTIF(Leads!C2:C;"Qualificado")'],
  [], [], [],
  ['Desqualificados', '', '', '', '', 'Taxa de qualificação'],
  ['=COUNTIF(Leads!C2:C;"Desqualificado")', '', '', '', '', '=IFERROR(COUNTIF(Leads!C2:C;"Qualificado")/1;0)'],
];

function legacyRow() {
  return LEGACY_HEADERS.map((header) => `${header}-valor`);
}

function historyValues(count = 52) {
  return [LEGACY_HEADERS, ...Array.from({ length: count }, (_, index) => [`history-${index + 1}`])];
}

function sourceRanges({ historyCount = 52, miniRows = [], leadsRows = [legacyRow()] } = {}) {
  return [
    [LEGACY_HEADERS, ...leadsRows],
    [LEGACY_HEADERS],
    [LEGACY_HEADERS],
    dashboard,
    historyValues(historyCount),
    [['Data de entrada', 'Status', 'Quando recebeu a medida protetiva?'], ...miniRows],
  ];
}

function createSheetsClient({ backupMatches = true, historyCount = 52, miniRows = [] } = {}) {
  const calls = { batchUpdates: [], reads: [] };
  let migrated = false;
  const source = sourceRanges({ historyCount, miniRows });
  const transformed = transformLeadValues(source[0]);
  const sheetsBefore = [
    ['Leads', 1, 23], ['Qualificados', 2, 23], ['Desqualificados', 3, 23],
    ['Visão geral', 4, 14], ['Histórico — Formulário anterior', 5, 23], ['Leads — Mini', 6, 17],
  ];
  return {
    calls,
    spreadsheets: {
      async get(options) {
        if (migrated) {
          return {
            data: { sheets: sheetsBefore.slice(0, 5).map(([title, sheetId, columnCount]) => ({
              properties: { title, sheetId, gridProperties: { columnCount: title === 'Visão geral' || title.startsWith('Histórico') ? columnCount : 18 } },
            })) },
          };
        }
        return {
          data: { sheets: sheetsBefore.map(([title, sheetId, columnCount]) => ({
            properties: { title, sheetId, gridProperties: { columnCount, rowCount: 1000 } },
          })) },
        };
      },
      async batchUpdate(options) {
        migrated = true;
        calls.batchUpdates.push(options);
        return { data: {} };
      },
      values: {
        async batchGet(options) {
          calls.reads.push(options);
          if (options.spreadsheetId === BACKUP_ID) {
            const backup = structuredClone(source);
            if (!backupMatches) backup[4][1][0] = 'history-alterado';
            return { data: { valueRanges: backup.map((values) => ({ values })) } };
          }
          if (migrated && options.ranges.length === 4) {
            return { data: { valueRanges: [
              { values: transformed }, { values: [FINAL_HEADERS] }, { values: [FINAL_HEADERS] }, { values: source[4] },
            ] } };
          }
          return { data: { valueRanges: source.map((values) => ({ values })) } };
        },
      },
    },
  };
}

test('reconhece somente os schemas legado de 23 e final de 18 colunas', () => {
  assert.equal(identifyHeaderVersion(LEGACY_HEADERS), 'legacy23');
  assert.equal(identifyHeaderVersion(FINAL_HEADERS), 'final18');
  assert.throws(() => identifyHeaderVersion(['Lead ID', 'Status']), /não corresponde/u);
});

test('transforma o schema legado para as 18 colunas na ordem aprovada', () => {
  const transformed = transformLeadValues([LEGACY_HEADERS, legacyRow()]);
  assert.deepEqual(transformed[0], LEAD_HEADERS);
  assert.equal(transformed[0].length, 18);
  assert.equal(transformed[1][3], 'Situação atual-valor');
  assert.equal(transformed[1][4], 'Momento da contratação-valor');
  assert.equal(transformed[1][5], 'WhatsApp-valor');
  assert.equal(transformed[1][17], 'Dispositivo-valor');
});

test('transformação do schema final é idempotente', () => {
  const row = FINAL_HEADERS.map((header) => `${header}-valor`);
  assert.deepEqual(transformLeadValues([FINAL_HEADERS, row]), [FINAL_HEADERS, row]);
});

test('validação de segurança exige 52 históricos únicos e Leads — Mini vazia', () => {
  const [leadsValues, , , , history, mini] = sourceRanges();
  const snapshot = validateSafetySnapshots({ leadsValues, historyValues: history, miniValues: mini });
  assert.equal(snapshot.historyIds.length, 52);
  assert.equal(snapshot.miniRows, 0);
  assert.throws(
    () => validateSafetySnapshots({ leadsValues, historyValues: historyValues(51), miniValues: mini }),
    /exatamente 52/u,
  );
  assert.throws(
    () => validateSafetySnapshots({ leadsValues, historyValues: history, miniValues: [mini[0], ['registro']] }),
    /não pode ser removida/u,
  );
});

test('dry-run valida plano sem escrever', async () => {
  const sheetsClient = createSheetsClient();
  const result = await runMigration({ dryRun: true, environment, sheetsClient });
  assert.equal(result.rows, 1);
  assert.equal(result.historyRows, 52);
  assert.equal(result.currentColumns, 23);
  assert.equal(result.finalColumns, 18);
  assert.equal(result.removedSheet, 'Leads — Mini');
  assert.equal(sheetsClient.calls.batchUpdates.length, 0);
});

test('migração real exige autorização e backup separado verificado', async () => {
  const client = createSheetsClient();
  await assert.rejects(() => runMigration({ environment, sheetsClient: client }), /CONFIRM_SHEET_MIGRATION/u);
  await assert.rejects(() => runMigration({
    environment: { ...environment, CONFIRM_SHEET_MIGRATION: 'true' }, sheetsClient: client,
  }), /CONFIRM_SHEET_BACKUP_VERIFIED/u);
  await assert.rejects(() => runMigration({
    environment: { ...environment, CONFIRM_SHEET_MIGRATION: 'true', CONFIRM_SHEET_BACKUP_VERIFIED: 'true' }, sheetsClient: client,
  }), /GOOGLE_SHEET_BACKUP_ID/u);
});

test('migração aborta se o backup não corresponder à produção', async () => {
  const client = createSheetsClient({ backupMatches: false });
  await assert.rejects(() => runMigration({
    environment: {
      ...environment, CONFIRM_SHEET_MIGRATION: 'true', CONFIRM_SHEET_BACKUP_VERIFIED: 'true',
      GOOGLE_SHEET_BACKUP_ID: BACKUP_ID,
    },
    sheetsClient: client,
  }), /backup informado não corresponde/u);
  assert.equal(client.calls.batchUpdates.length, 0);
});

test('migração confirmada prepara schema, fórmulas, filtros e remoção da aba Mini', async () => {
  const client = createSheetsClient();
  const result = await runMigration({
    environment: {
      ...environment, CONFIRM_SHEET_MIGRATION: 'true', CONFIRM_SHEET_BACKUP_VERIFIED: 'true',
      GOOGLE_SHEET_BACKUP_ID: BACKUP_ID,
    },
    sheetsClient: client,
  });
  assert.equal(result.migrated, true);
  assert.equal(result.backupVerified, true);
  assert.equal(result.historyPreserved, true);
  const requests = client.calls.batchUpdates[0].requestBody.requests;
  assert.equal(requests.filter((request) => request.deleteDimension).length, 3);
  assert.equal(requests.filter((request) => request.setBasicFilter).length, 3);
  assert.equal(requests.filter((request) => request.deleteSheet?.sheetId === 6).length, 1);
  assert.equal(JSON.stringify(requests).includes('"sheetId":5'), false);
  const formulas = requests.flatMap((request) => request.updateCells?.rows ?? [])
    .flatMap((row) => row.values ?? [])
    .map(({ userEnteredValue }) => userEnteredValue?.formulaValue)
    .filter(Boolean);
  assert.ok(formulas.includes(DERIVED_VIEW_FORMULAS.Qualificados));
  assert.ok(formulas.includes(DERIVED_VIEW_FORMULAS.Desqualificados));
});
