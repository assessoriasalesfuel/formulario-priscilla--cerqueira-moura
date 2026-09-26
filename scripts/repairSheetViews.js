import { google } from 'googleapis';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { hasCanonicalLeadHeaders, LEAD_HEADERS } from '../server/leadSchema.js';
import {
  DASHBOARD_FORMULAS,
  DERIVED_VIEW_FORMULAS,
  VIEW_FORMULA_COUNT,
} from '../server/sheetViewFormulas.js';

const EXPECTED_SPREADSHEET_ID = '1zzeazzXlD3XI1ZnTQoO9MX27DvqHlionTDPqhHA5UEA';
const REQUIRED_SHEETS = Object.freeze(['Leads', 'Visão geral', 'Qualificados', 'Desqualificados']);
const VALID_STATUSES = new Set(['Qualificado', 'Desqualificado', 'Em preenchimento']);

function readConfiguration(environment) {
  const spreadsheetId = environment.GOOGLE_SHEET_ID?.trim();
  const clientEmail = environment.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = environment.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!spreadsheetId || !clientEmail || !privateKey) {
    throw new Error('As variáveis do Google Sheets não estão configuradas.');
  }
  if (spreadsheetId !== EXPECTED_SPREADSHEET_ID) {
    throw new Error('GOOGLE_SHEET_ID não corresponde à planilha autorizada para este reparo.');
  }
  return { spreadsheetId, clientEmail, privateKey };
}

async function createClient(configuration) {
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: configuration.clientEmail, private_key: configuration.privateKey },
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
  const records = rows
    .filter((row) => String(row[0] ?? '').trim() !== '')
    .map((row) => ({ leadId: String(row[0]), status: String(row[2] ?? '') }));
  if (records.some(({ status }) => !VALID_STATUSES.has(status))) {
    throw new Error('A aba Leads contém Status inesperado.');
  }
  const leadIds = records.map(({ leadId }) => leadId);
  if (new Set(leadIds).size !== leadIds.length) {
    throw new Error('A aba Leads contém Lead IDs duplicados.');
  }
  return Object.freeze({
    leadIds,
    qualifiedIds: records.filter(({ status }) => status === 'Qualificado').map(({ leadId }) => leadId),
    disqualifiedIds: records.filter(({ status }) => status === 'Desqualificado').map(({ leadId }) => leadId),
    fillingIds: records.filter(({ status }) => status === 'Em preenchimento').map(({ leadId }) => leadId),
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
    if (matches.length !== 1) {
      throw new Error(`O indicador ${label} não foi encontrado uma única vez na aba Visão geral.`);
    }
    const { rowIndex, columnIndex } = matches[0];
    const candidates = [
      { rowIndex: rowIndex + 1, columnIndex },
      { rowIndex, columnIndex: columnIndex + 1 },
    ].filter(({ rowIndex: candidateRow, columnIndex: candidateColumn }) => {
      const value = values[candidateRow]?.[candidateColumn];
      return typeof value === 'string' && value.startsWith('=');
    });
    if (candidates.length !== 1) {
      throw new Error(`Não foi encontrada uma única fórmula adjacente ao indicador ${label}.`);
    }
    const target = candidates[0];
    const currentFormula = values[target.rowIndex][target.columnIndex];
    const cell = `${columnName(target.columnIndex)}${target.rowIndex + 1}`;
    return { label, range: `'Visão geral'!${cell}`, currentFormula, formula };
  });
}

function validateHeaders(headerRanges) {
  const leadsHeaders = headerRanges[0] ?? [];
  if (!hasCanonicalLeadHeaders(leadsHeaders)) {
    throw new Error('A aba Leads não possui exatamente os 23 cabeçalhos esperados em A:W.');
  }
  for (const [index, title] of ['Qualificados', 'Desqualificados'].entries()) {
    if (!hasCanonicalLeadHeaders(headerRanges[index + 1] ?? [])) {
      throw new Error(`A aba ${title} não possui os 23 cabeçalhos esperados em A:W.`);
    }
  }
}

function validateDerivedRows(rows, expectedStatus, expectedIds) {
  const records = rows.filter((row) => String(row[0] ?? '').trim() !== '');
  if (records.some((row) => row[2] !== expectedStatus)) {
    throw new Error(`A aba derivada de ${expectedStatus} contém Status inesperado.`);
  }
  const actualIds = records.map((row) => String(row[0]));
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    throw new Error(`A aba derivada de ${expectedStatus} não corresponde à aba Leads.`);
  }
}

function numberFromRange(valueRange) {
  const value = valueRange?.values?.[0]?.[0];
  return typeof value === 'number' ? value : Number(value);
}

function validateDashboardValues(valueRanges, snapshot) {
  const qualified = snapshot.qualifiedIds.length;
  const disqualified = snapshot.disqualifiedIds.length;
  const expectedRate = qualified + disqualified === 0 ? 0 : qualified / (qualified + disqualified);
  const expected = [snapshot.leadIds.length, qualified, disqualified, expectedRate];
  expected.forEach((value, index) => {
    const actual = numberFromRange(valueRanges[index]);
    if (!Number.isFinite(actual) || Math.abs(actual - value) > 1e-10) {
      throw new Error('Os indicadores da Visão geral não correspondem à aba Leads.');
    }
  });
}

export async function runSheetViewRepair({
  dryRun = false,
  environment = process.env,
  sheetsClient,
} = {}) {
  if (!dryRun && environment.CONFIRM_SHEET_VIEW_REPAIR !== 'true') {
    throw new Error('Reparo bloqueado: defina CONFIRM_SHEET_VIEW_REPAIR=true para permitir alterações.');
  }
  const configuration = readConfiguration(environment);
  const sheets = sheetsClient ?? await createClient(configuration);
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId: configuration.spreadsheetId,
    fields: 'properties(locale),sheets(properties(sheetId,title,gridProperties(columnCount)))',
  });
  if (metadata.data.properties?.locale !== 'pt_BR') {
    throw new Error('O locale da planilha deve ser pt_BR antes do reparo.');
  }
  const titles = new Set((metadata.data.sheets ?? []).map((sheet) => sheet.properties.title));
  const missingSheets = REQUIRED_SHEETS.filter((title) => !titles.has(title));
  if (missingSheets.length) throw new Error(`Abas obrigatórias ausentes: ${missingSheets.join(', ')}.`);
  const leadsMetadata = (metadata.data.sheets ?? []).find((sheet) => sheet.properties.title === 'Leads');
  if (leadsMetadata?.properties.gridProperties?.columnCount !== LEAD_HEADERS.length) {
    throw new Error('A aba Leads deve possuir exatamente 23 colunas físicas, de A até W.');
  }

  const structure = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: configuration.spreadsheetId,
    ranges: [
      "'Leads'!A1:X1",
      "'Qualificados'!A1:W1",
      "'Desqualificados'!A1:W1",
      "'Visão geral'!A1:Z100",
      "'Qualificados'!A2",
      "'Desqualificados'!A2",
    ],
    valueRenderOption: 'FORMULA',
  });
  const structureRanges = structure.data.valueRanges ?? [];
  if (structureRanges.length !== 6) throw new Error('Não foi possível validar todas as faixas do reparo.');
  validateHeaders(structureRanges.slice(0, 3).map((range) => range.values?.[0] ?? []));
  const dashboardTargets = findDashboardFormulaTargets(structureRanges[3].values ?? []);

  const leadValues = await sheets.spreadsheets.values.get({
    spreadsheetId: configuration.spreadsheetId,
    range: "'Leads'!A2:C",
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const before = createLeadSnapshot(leadValues.data.values ?? []);
  const changes = [
    ...dashboardTargets,
    {
      label: 'Qualificados!A2', range: "'Qualificados'!A2",
      currentFormula: structureRanges[4].values?.[0]?.[0] ?? '', formula: DERIVED_VIEW_FORMULAS.Qualificados,
    },
    {
      label: 'Desqualificados!A2', range: "'Desqualificados'!A2",
      currentFormula: structureRanges[5].values?.[0]?.[0] ?? '', formula: DERIVED_VIEW_FORMULAS.Desqualificados,
    },
  ];
  if (changes.length !== VIEW_FORMULA_COUNT) throw new Error('A lista de fórmulas do reparo está incompleta.');
  if (changes.slice(4).some(({ currentFormula }) => typeof currentFormula !== 'string' || !currentFormula.startsWith('='))) {
    throw new Error('As fórmulas atuais das abas derivadas não foram encontradas em A2.');
  }

  const summary = {
    dryRun,
    formulaChanges: changes.length,
    total: before.leadIds.length,
    qualified: before.qualifiedIds.length,
    disqualified: before.disqualifiedIds.length,
    filling: before.fillingIds.length,
    targetRanges: changes.map(({ range }) => range),
  };
  if (dryRun) return summary;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: configuration.spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: changes.map(({ range, formula }) => ({ range, majorDimension: 'ROWS', values: [[formula]] })),
    },
  });

  const afterLeadValues = await sheets.spreadsheets.values.get({
    spreadsheetId: configuration.spreadsheetId,
    range: "'Leads'!A2:C",
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const after = createLeadSnapshot(afterLeadValues.data.values ?? []);
  assertLeadSnapshotsEqual(before, after);

  const formulaVerification = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: configuration.spreadsheetId,
    ranges: changes.map(({ range }) => range),
    valueRenderOption: 'FORMULA',
  });
  const verifiedFormulas = formulaVerification.data.valueRanges ?? [];
  changes.forEach(({ formula }, index) => {
    if (verifiedFormulas[index]?.values?.[0]?.[0] !== formula) {
      throw new Error('A verificação das fórmulas reparadas falhou.');
    }
  });

  const results = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: configuration.spreadsheetId,
    ranges: [
      ...dashboardTargets.map(({ range }) => range),
      "'Qualificados'!A2:C",
      "'Desqualificados'!A2:C",
    ],
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  const resultRanges = results.data.valueRanges ?? [];
  validateDashboardValues(resultRanges.slice(0, 4), after);
  validateDerivedRows(resultRanges[4]?.values ?? [], 'Qualificado', after.qualifiedIds);
  validateDerivedRows(resultRanges[5]?.values ?? [], 'Desqualificado', after.disqualifiedIds);

  return { ...summary, dryRun: false, repaired: true, leadsPreserved: true };
}

function printSummary(summary) {
  console.log(`Modo: ${summary.dryRun ? 'dry-run' : 'reparo confirmado'}`);
  console.log(`Fórmulas analisadas: ${summary.formulaChanges}`);
  console.log(`Total de leads: ${summary.total}`);
  console.log(`Qualificados esperados: ${summary.qualified}`);
  console.log(`Desqualificados esperados: ${summary.disqualified}`);
  console.log(`Em preenchimento esperados: ${summary.filling}`);
  console.log(`Faixas permitidas: ${summary.targetRanges.join(', ')}`);
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  runSheetViewRepair({ dryRun: process.argv.includes('--dry-run') })
    .then(printSummary)
    .catch((error) => {
      console.error(`Reparo abortado: ${error.message}`);
      process.exitCode = 1;
    });
}
