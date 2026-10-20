import { google } from 'googleapis';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { hasCanonicalLeadHeaders, LEAD_HEADERS, LEAD_LAST_COLUMN } from '../server/leadSchema.js';

export const DASHBOARD_FORMULAS = Object.freeze({
  'TOTAL DE LEADS': '=COUNTA(INDIRECT("Leads!A2:A"))',
  QUALIFICADOS: '=COUNTIF(INDIRECT("Leads!E2:E");"Qualificado")',
  DESQUALIFICADOS: '=COUNTIF(INDIRECT("Leads!E2:E");"Desqualificado")',
  'TAXA DE QUALIFICAÇÃO': '=IFERROR(COUNTIF(INDIRECT("Leads!E2:E");"Qualificado")/COUNTA(INDIRECT("Leads!A2:A"));0)',
});
export const DERIVED_VIEW_FORMULAS = Object.freeze({
  Qualificados: '=IFERROR(FILTER(Leads!A2:X;Leads!E2:E="Qualificado";Leads!A2:A<>"");"")',
  Desqualificados: '=IFERROR(FILTER(Leads!A2:X;((Leads!E2:E="Desqualificado")+(Leads!E2:E="Pendente de qualificação financeira"))>0;Leads!A2:A<>"");"")',
});
const VIEW_FORMULA_COUNT = Object.keys(DASHBOARD_FORMULAS).length + Object.keys(DERIVED_VIEW_FORMULAS).length;
const DERIVED_VIEW_LAST_COLUMN = 'X';

const EXPECTED_SPREADSHEET_ID = '1fxbX7pDxaLSPCfVgkYyI8F086D6q32xsbrSQS-edwDg';
const DASHBOARD_SHEET_NAME = 'Visão geral';
const REQUIRED_SHEETS = Object.freeze([DASHBOARD_SHEET_NAME, 'Leads', 'Qualificados', 'Desqualificados']);
const VALID_STATUSES = new Set([
  'Qualificado', 'Pendente de qualificação financeira', 'Desqualificado',
]);

function readConfiguration(environment) {
  const spreadsheetId = environment.GOOGLE_SHEET_ID?.trim();
  const clientEmail = environment.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = environment.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const credentialsFile = environment.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (!spreadsheetId || (!credentialsFile && (!clientEmail || !privateKey))) {
    throw new Error('As variáveis do Google Sheets não estão configuradas.');
  }
  if (spreadsheetId !== EXPECTED_SPREADSHEET_ID) throw new Error('GOOGLE_SHEET_ID não corresponde ao CRM definitivo.');
  return { spreadsheetId, clientEmail, privateKey, credentialsFile };
}

async function createClient(configuration) {
  const auth = new google.auth.GoogleAuth({
    ...(configuration.credentialsFile ? { keyFile: configuration.credentialsFile }
      : { credentials: { client_email: configuration.clientEmail, private_key: configuration.privateKey } }),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

function columnName(index) {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

export function createLeadSnapshot(rows = []) {
  const records = rows.filter((row) => String(row[0] ?? '').trim())
    .map((row) => ({ leadId: String(row[0]), status: String(row[4] ?? '') }));
  if (records.some(({ status }) => !VALID_STATUSES.has(status))) throw new Error('A aba Leads contém status inesperado.');
  const leadIds = records.map(({ leadId }) => leadId);
  if (new Set(leadIds).size !== leadIds.length) throw new Error('A aba Leads contém Lead IDs duplicados.');
  return Object.freeze({
    leadIds,
    qualifiedIds: records.filter(({ status }) => status === 'Qualificado').map(({ leadId }) => leadId),
    pendingIds: records.filter(({ status }) => status === 'Pendente de qualificação financeira')
      .map(({ leadId }) => leadId),
    disqualifiedIds: records.filter(({ status }) => status === 'Desqualificado').map(({ leadId }) => leadId),
    nonQualifiedIds: records.filter(({ status }) => status !== 'Qualificado').map(({ leadId }) => leadId),
  });
}

export function assertLeadSnapshotsEqual(before, after) {
  if (JSON.stringify(before.leadIds) !== JSON.stringify(after.leadIds)) {
    throw new Error('Os Lead IDs mudaram durante o reparo; validação pós-reparo falhou.');
  }
}

export function findDashboardFormulaTargets(values = []) {
  return Object.entries(DASHBOARD_FORMULAS).map(([label, formula]) => {
    const matches = [];
    values.forEach((row, rowIndex) => row.forEach((value, columnIndex) => {
      if (value === label) matches.push({ rowIndex, columnIndex });
    }));
    if (matches.length !== 1) throw new Error(`O indicador ${label} não foi encontrado uma única vez no Dashboard.`);
    const { rowIndex, columnIndex } = matches[0];
    const candidates = [{ rowIndex: rowIndex + 1, columnIndex }, { rowIndex, columnIndex: columnIndex + 1 }]
      .filter(({ rowIndex: r, columnIndex: c }) => String(values[r]?.[c] ?? '').startsWith('='));
    if (candidates.length !== 1) throw new Error(`Não foi encontrada uma única fórmula adjacente ao indicador ${label}.`);
    const target = candidates[0];
    return { label, range: `'${DASHBOARD_SHEET_NAME}'!${columnName(target.columnIndex)}${target.rowIndex + 1}`,
      currentFormula: values[target.rowIndex][target.columnIndex], formula };
  });
}

function validateDerivedArea(values, title) {
  const occupied = values.flatMap((row, rowIndex) => row.map((value, columnIndex) => ({ value, rowIndex, columnIndex })))
    .filter(({ value }) => value !== '' && value !== null && value !== undefined);
  const valid = !occupied.length || (occupied.length === 1 && occupied[0].rowIndex === 0
    && occupied[0].columnIndex === 0 && String(occupied[0].value).startsWith('='));
  if (!valid) throw new Error(`A área de expansão da aba ${title} não está livre.`);
}

function validateDerivedRows(rows, expectedStatuses, expectedIds, title) {
  const records = rows.filter((row) => String(row[0] ?? '').trim());
  if (records.some((row) => !expectedStatuses.includes(row[4]))) throw new Error(`A aba ${title} contém status inesperado.`);
  if (JSON.stringify(records.map((row) => String(row[0]))) !== JSON.stringify(expectedIds)) {
    throw new Error(`A aba ${title} não corresponde à aba Leads.`);
  }
}

export async function runSheetViewRepair({ dryRun = false, environment = process.env, sheetsClient } = {}) {
  if (!dryRun && environment.CONFIRM_SHEET_VIEW_REPAIR !== 'true') {
    throw new Error('Reparo bloqueado: defina CONFIRM_SHEET_VIEW_REPAIR=true para permitir alterações.');
  }
  const configuration = readConfiguration(environment);
  const sheets = sheetsClient ?? await createClient(configuration);
  const metadata = await sheets.spreadsheets.get({ spreadsheetId: configuration.spreadsheetId,
    fields: 'properties(locale),sheets(properties(sheetId,title,gridProperties(columnCount)))' });
  if (metadata.data.properties?.locale !== 'pt_BR') throw new Error('O locale da planilha deve ser pt_BR.');
  const sheetMap = new Map((metadata.data.sheets ?? []).map((sheet) => [sheet.properties.title, sheet]));
  if ((metadata.data.sheets ?? []).length !== 4 || REQUIRED_SHEETS.some((title) => !sheetMap.has(title))) {
    throw new Error('O CRM deve possuir exatamente Visão geral, Leads, Qualificados e Desqualificados.');
  }
  for (const title of ['Leads', 'Qualificados', 'Desqualificados']) {
    if (sheetMap.get(title)?.properties.gridProperties?.columnCount < LEAD_HEADERS.length) {
      throw new Error(`A aba ${title} deve possuir ao menos ${LEAD_HEADERS.length} colunas físicas, de A até ${LEAD_LAST_COLUMN}.`);
    }
  }

  const structure = await sheets.spreadsheets.values.batchGet({ spreadsheetId: configuration.spreadsheetId,
    ranges: [`'Leads'!A1:${LEAD_LAST_COLUMN}1`, `'Qualificados'!A1:${LEAD_LAST_COLUMN}1`,
      `'Desqualificados'!A1:${LEAD_LAST_COLUMN}1`, `'${DASHBOARD_SHEET_NAME}'!A1:N30`,
      `'Qualificados'!A2:${DERIVED_VIEW_LAST_COLUMN}`, `'Desqualificados'!A2:${DERIVED_VIEW_LAST_COLUMN}`],
    valueRenderOption: 'FORMULA' });
  const ranges = structure.data.valueRanges ?? [];
  if (ranges.length !== 6) throw new Error('Não foi possível validar todas as faixas do reparo.');
  for (const [index, title] of ['Leads', 'Qualificados', 'Desqualificados'].entries()) {
    if (!hasCanonicalLeadHeaders(ranges[index]?.values?.[0] ?? [])) throw new Error(`Cabeçalho incompatível na aba ${title}.`);
  }
  const dashboardTargets = findDashboardFormulaTargets(ranges[3].values ?? []);
  validateDerivedArea(ranges[4].values ?? [], 'Qualificados');
  validateDerivedArea(ranges[5].values ?? [], 'Desqualificados');
  const leadValues = await sheets.spreadsheets.values.get({ spreadsheetId: configuration.spreadsheetId,
    range: "'Leads'!A2:E", valueRenderOption: 'FORMATTED_VALUE' });
  const before = createLeadSnapshot(leadValues.data.values ?? []);
  const changes = [...dashboardTargets,
    { label: 'Qualificados!A2', range: "'Qualificados'!A2", currentFormula: ranges[4].values?.[0]?.[0] ?? '', formula: DERIVED_VIEW_FORMULAS.Qualificados },
    { label: 'Desqualificados!A2', range: "'Desqualificados'!A2", currentFormula: ranges[5].values?.[0]?.[0] ?? '', formula: DERIVED_VIEW_FORMULAS.Desqualificados }];
  if (changes.length !== VIEW_FORMULA_COUNT) throw new Error('A lista de fórmulas está incompleta.');
  const summary = { dryRun, formulaChanges: changes.length, total: before.leadIds.length,
    qualified: before.qualifiedIds.length, pending: before.pendingIds.length,
    disqualified: before.disqualifiedIds.length,
    targetRanges: changes.map(({ range }) => range) };
  if (dryRun) return summary;

  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: configuration.spreadsheetId,
    requestBody: { valueInputOption: 'USER_ENTERED',
      data: changes.map(({ range, formula }) => ({ range, majorDimension: 'ROWS', values: [[formula]] })) } });
  const afterLeadValues = await sheets.spreadsheets.values.get({ spreadsheetId: configuration.spreadsheetId,
    range: "'Leads'!A2:E", valueRenderOption: 'FORMATTED_VALUE' });
  const after = createLeadSnapshot(afterLeadValues.data.values ?? []);
  assertLeadSnapshotsEqual(before, after);
  const results = await sheets.spreadsheets.values.batchGet({ spreadsheetId: configuration.spreadsheetId,
    ranges: [...dashboardTargets.map(({ range }) => range),
      "'Qualificados'!A2:E", "'Desqualificados'!A2:E"], valueRenderOption: 'UNFORMATTED_VALUE' });
  const output = results.data.valueRanges ?? [];
  const expected = [after.leadIds.length, after.qualifiedIds.length, after.disqualifiedIds.length,
    after.leadIds.length ? after.qualifiedIds.length / after.leadIds.length : 0];
  expected.forEach((value, index) => {
    const actual = Number(output[index]?.values?.[0]?.[0]);
    if (!Number.isFinite(actual) || Math.abs(actual - value) > 1e-10) throw new Error('Indicadores do Dashboard incorretos.');
  });
  validateDerivedRows(output[4]?.values ?? [], ['Qualificado'], after.qualifiedIds, 'Qualificados');
  validateDerivedRows(output[5]?.values ?? [], ['Pendente de qualificação financeira', 'Desqualificado'],
    after.nonQualifiedIds, 'Desqualificados');
  return { ...summary, dryRun: false, repaired: true, leadsPreserved: true };
}

function printSummary(summary) {
  console.log(`Modo: ${summary.dryRun ? 'dry-run' : 'reparo confirmado'}`);
  console.log(`Fórmulas analisadas: ${summary.formulaChanges}`);
  console.log(`Total de leads: ${summary.total}`);
  console.log(`Qualificados esperados: ${summary.qualified}`);
  console.log(`Pendentes de qualificação financeira: ${summary.pending}`);
  console.log(`Desqualificados esperados: ${summary.disqualified}`);
  console.log(`Faixas permitidas: ${summary.targetRanges.join(', ')}`);
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) runSheetViewRepair({ dryRun: process.argv.includes('--dry-run') })
  .then(printSummary).catch((error) => { console.error(`Reparo abortado: ${error.message}`); process.exitCode = 1; });
