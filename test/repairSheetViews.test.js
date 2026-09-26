import test from 'node:test';
import assert from 'node:assert/strict';
import { LEAD_HEADERS } from '../server/leadSchema.js';
import { DASHBOARD_FORMULAS, DERIVED_VIEW_FORMULAS } from '../server/sheetViewFormulas.js';
import {
  assertLeadSnapshotsEqual,
  createLeadSnapshot,
  findDashboardFormulaTargets,
  runSheetViewRepair,
} from '../scripts/repairSheetViews.js';

const environment = {
  GOOGLE_SHEET_ID: '1zzeazzXlD3XI1ZnTQoO9MX27DvqHlionTDPqhHA5UEA',
  GOOGLE_SERVICE_ACCOUNT_EMAIL: 'repair@example.test',
  GOOGLE_PRIVATE_KEY: 'line-1\\nline-2',
};

const leadRows = [
  ['lead-1', '2026-09-01', 'Qualificado'],
  ['lead-2', '2026-09-02', 'Desqualificado'],
  ['lead-3', '2026-09-03', 'Em preenchimento'],
  ['lead-4', '2026-09-04', 'Qualificado'],
];

const dashboardGrid = [
  [],
  [],
  [],
  [],
  ['Total de leads', '', '', '', '', 'Qualificados'],
  ['=COUNTA(Leads!A11:A)', '', '', '', '', '=COUNTIF(Leads!C11:C;"Qualificado")'],
  [],
  [],
  [],
  ['Desqualificados', '', '', '', '', 'Taxa de qualificação'],
  ['=COUNTIF(Leads!C11:C;"Desqualificado")', '', '', '', '', '=IFERROR(COUNTIF(Leads!C11:C;"Qualificado")/3;0)'],
  [],
  ['e-mail da conta de serviço do google cloud:', 'repair@example.test'],
];

function createSheetsClient({
  locale = 'pt_BR',
  leadsAfter = leadRows,
  leadsHeaders = LEAD_HEADERS,
  leadsColumnCount = 23,
} = {}) {
  const writes = [];
  let leadReads = 0;
  return {
    writes,
    spreadsheets: {
      async get() {
        return {
          data: {
            properties: { locale },
            sheets: ['Leads', 'Visão geral', 'Qualificados', 'Desqualificados'].map((title, index) => ({
              properties: {
                title,
                sheetId: index + 1,
                gridProperties: { columnCount: title === 'Visão geral' ? 26 : title === 'Leads' ? leadsColumnCount : 23 },
              },
            })),
          },
        };
      },
      values: {
        async get(options) {
          assert.equal(options.range, "'Leads'!A2:C");
          leadReads += 1;
          return { data: { values: leadReads === 1 ? leadRows : leadsAfter } };
        },
        async batchGet(options) {
          if (options.ranges.includes("'Visão geral'!A1:Z100")) {
            return {
              data: {
                valueRanges: [
                  { values: [leadsHeaders] },
                  { values: [LEAD_HEADERS] },
                  { values: [LEAD_HEADERS] },
                  { values: dashboardGrid },
                  { values: [['=IFERROR(QUERY(Leads!A11:V;"select * where C = \'Qualificado\'";0);"")']] },
                  { values: [['=IFERROR(QUERY(Leads!A11:V;"select * where C = \'Desqualificado\'";0);"")']] },
                ],
              },
            };
          }
          if (options.valueRenderOption === 'FORMULA') {
            return {
              data: {
                valueRanges: options.ranges.map((range) => ({
                  values: [[writes.find((write) => write.range === range)?.values[0][0]]],
                })),
              },
            };
          }
          return {
            data: {
              valueRanges: [
                { values: [[4]] },
                { values: [[2]] },
                { values: [[1]] },
                { values: [[2 / 3]] },
                { values: [leadRows[0], leadRows[3]] },
                { values: [leadRows[1]] },
              ],
            },
          };
        },
        async batchUpdate(options) {
          writes.push(...options.requestBody.data);
          return { data: { totalUpdatedCells: options.requestBody.data.length } };
        },
      },
    },
  };
}

test('fórmulas resilientes começam logicamente na linha 2 e nunca usam linha 11', () => {
  const formulas = [...Object.values(DASHBOARD_FORMULAS), ...Object.values(DERIVED_VIEW_FORMULAS)];
  formulas.forEach((formula) => {
    assert.match(formula, /INDIRECT\("Leads![AC]2:/u);
    assert.doesNotMatch(formula, /11/u);
  });
  assert.match(DERIVED_VIEW_FORMULAS.Qualificados, /Leads!A2:W/u);
  assert.match(DERIVED_VIEW_FORMULAS.Desqualificados, /Leads!A2:W/u);
});

test('métricas contam todos os leads e excluem Em preenchimento das derivadas e da taxa', () => {
  const snapshot = createLeadSnapshot(leadRows);
  assert.equal(snapshot.leadIds.length, 4);
  assert.deepEqual(snapshot.qualifiedIds, ['lead-1', 'lead-4']);
  assert.deepEqual(snapshot.disqualifiedIds, ['lead-2']);
  assert.deepEqual(snapshot.fillingIds, ['lead-3']);
  const rate = snapshot.qualifiedIds.length / (snapshot.qualifiedIds.length + snapshot.disqualifiedIds.length);
  assert.equal(rate, 2 / 3);
});

test('localiza somente as quatro fórmulas adjacentes aos indicadores existentes', () => {
  const targets = findDashboardFormulaTargets(dashboardGrid);
  assert.deepEqual(targets.map(({ range }) => range), [
    "'Visão geral'!A6", "'Visão geral'!F6", "'Visão geral'!A11", "'Visão geral'!F11",
  ]);
  assert.equal(targets.some(({ range }) => range.includes('A13') || range.includes('B13')), false);
});

test('dry-run valida e calcula sem realizar qualquer escrita', async () => {
  const client = createSheetsClient();
  const result = await runSheetViewRepair({ dryRun: true, environment, sheetsClient: client });
  assert.deepEqual(
    { changes: result.formulaChanges, total: result.total, qualified: result.qualified, disqualified: result.disqualified, filling: result.filling },
    { changes: 6, total: 4, qualified: 2, disqualified: 1, filling: 1 },
  );
  assert.equal(client.writes.length, 0);
});

test('reparo sem confirmação por ambiente aborta antes de escrever', async () => {
  const client = createSheetsClient();
  await assert.rejects(() => runSheetViewRepair({ environment, sheetsClient: client }), /CONFIRM_SHEET_VIEW_REPAIR=true/u);
  assert.equal(client.writes.length, 0);
});

test('reparo escreve exclusivamente as seis células permitidas e nunca a aba Leads', async () => {
  const client = createSheetsClient();
  const result = await runSheetViewRepair({
    environment: { ...environment, CONFIRM_SHEET_VIEW_REPAIR: 'true' },
    sheetsClient: client,
  });
  assert.equal(result.repaired, true);
  assert.equal(result.leadsPreserved, true);
  assert.deepEqual(client.writes.map(({ range }) => range), [
    "'Visão geral'!A6", "'Visão geral'!F6", "'Visão geral'!A11", "'Visão geral'!F11",
    "'Qualificados'!A2", "'Desqualificados'!A2",
  ]);
  assert.equal(client.writes.some(({ range }) => range.startsWith("'Leads'!")), false);
});

test('reparo usa exatamente as fórmulas INDIRECT aprovadas', async () => {
  const client = createSheetsClient();
  await runSheetViewRepair({
    environment: { ...environment, CONFIRM_SHEET_VIEW_REPAIR: 'true' },
    sheetsClient: client,
  });
  assert.deepEqual(client.writes.map(({ values }) => values[0][0]), [
    ...Object.values(DASHBOARD_FORMULAS),
    DERIVED_VIEW_FORMULAS.Qualificados,
    DERIVED_VIEW_FORMULAS.Desqualificados,
  ]);
});

test('reparo aborta se os cabeçalhos de Leads não forem exatamente A:W', async () => {
  const client = createSheetsClient({ leadsHeaders: [...LEAD_HEADERS, 'Extra'] });
  await assert.rejects(
    () => runSheetViewRepair({ dryRun: true, environment, sheetsClient: client }),
    /23 cabeçalhos/u,
  );
  assert.equal(client.writes.length, 0);
});

test('reparo exige locale pt_BR antes de interpretar fórmulas', async () => {
  const client = createSheetsClient({ locale: 'en_US' });
  await assert.rejects(
    () => runSheetViewRepair({ dryRun: true, environment, sheetsClient: client }),
    /pt_BR/u,
  );
  assert.equal(client.writes.length, 0);
});

test('reparo aborta se Leads não possuir exatamente 23 colunas físicas', async () => {
  const client = createSheetsClient({ leadsColumnCount: 30 });
  await assert.rejects(
    () => runSheetViewRepair({ dryRun: true, environment, sheetsClient: client }),
    /23 colunas físicas/u,
  );
  assert.equal(client.writes.length, 0);
});

test('validação detecta qualquer alteração nos Lead IDs', () => {
  const before = createLeadSnapshot(leadRows);
  const after = createLeadSnapshot([
    ['lead-1', '2026-09-01', 'Qualificado'],
    ['lead-alterado', '2026-09-02', 'Desqualificado'],
    ...leadRows.slice(2),
  ]);
  assert.throws(() => assertLeadSnapshotsEqual(before, after), /Lead IDs mudaram/u);
});

test('reparo falha na validação pós-escrita se Lead IDs mudarem', async () => {
  const client = createSheetsClient({ leadsAfter: leadRows.slice(0, -1) });
  await assert.rejects(
    () => runSheetViewRepair({
      environment: { ...environment, CONFIRM_SHEET_VIEW_REPAIR: 'true' },
      sheetsClient: client,
    }),
    /Lead IDs mudaram/u,
  );
});
