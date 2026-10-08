import { google } from 'googleapis';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { LEAD_HEADERS } from '../server/leadSchema.js';
import { DASHBOARD_FORMULAS, DERIVED_VIEW_FORMULAS } from '../server/sheetViewFormulas.js';

const EXPECTED_SPREADSHEET_ID = '1zzeazzXlD3XI1ZnTQoO9MX27DvqHlionTDPqhHA5UEA';
const HISTORY_SHEET = 'Histórico — Formulário anterior';
const MINI_SHEET = 'Leads — Mini';
const EXPECTED_HISTORY_COUNT = 52;
const REQUIRED_SHEETS = ['Leads', 'Qualificados', 'Desqualificados', 'Visão geral', HISTORY_SHEET, MINI_SHEET];

export const FINAL_HEADERS = LEAD_HEADERS;
export const LEGACY_HEADERS = Object.freeze([
  'Lead ID', 'Data de criação', 'Status', 'Nome', 'WhatsApp', 'E-mail', 'Situação atual',
  'Faixa de renda', 'Faixa de pensão alimentícia', 'Urgência', 'Momento da contratação',
  'Motivo da classificação', 'Data de conclusão', 'Consentimento de dados',
  'Autorização de contato', 'UTM Source', 'UTM Medium', 'UTM Campaign', 'UTM Content',
  'UTM Term', 'FBCLID', 'URL de entrada', 'Dispositivo',
]);
export const REMOVED_HEADERS = Object.freeze(LEGACY_HEADERS.filter((header) => ![
  'Lead ID', 'Data de criação', 'Status', 'WhatsApp', 'Motivo da classificação',
  'Data de conclusão', 'Consentimento de dados', 'Autorização de contato', 'UTM Source',
  'UTM Medium', 'UTM Campaign', 'UTM Content', 'UTM Term', 'FBCLID', 'URL de entrada', 'Dispositivo',
].includes(header)));

function trimmedHeaders(row = []) {
  const headers = row.map((value) => String(value ?? '').trim());
  while (headers.at(-1) === '') headers.pop();
  return headers;
}

function sameHeaders(actual, expected) {
  return actual.length === expected.length && expected.every((header, index) => actual[index] === header);
}

export function identifyHeaderVersion(row) {
  const headers = trimmedHeaders(row);
  if (sameHeaders(headers, LEGACY_HEADERS)) return 'legacy23';
  if (sameHeaders(headers, FINAL_HEADERS)) return 'final18';
  throw new Error('A estrutura de cabeçalhos não corresponde ao schema legado de 23 ou ao novo schema de 18 colunas.');
}

const LEGACY_TO_FINAL = Object.freeze({
  'Lead ID': 'Lead ID',
  'Data de criação': 'Data de criação',
  Status: 'Status',
  'Tempo desde a medida protetiva': 'Situação atual',
  'Disponibilidade para investir': 'Momento da contratação',
  WhatsApp: 'WhatsApp',
  'Motivo da classificação': 'Motivo da classificação',
  'Data de conclusão': 'Data de conclusão',
  'Consentimento de dados': 'Consentimento de dados',
  'Autorização de contato': 'Autorização de contato',
  'UTM Source': 'UTM Source',
  'UTM Medium': 'UTM Medium',
  'UTM Campaign': 'UTM Campaign',
  'UTM Content': 'UTM Content',
  'UTM Term': 'UTM Term',
  FBCLID: 'FBCLID',
  'URL de entrada': 'URL de entrada',
  Dispositivo: 'Dispositivo',
});

export function transformLeadValues(values = []) {
  if (!values.length) throw new Error('A aba Leads não possui cabeçalhos.');
  const version = identifyHeaderVersion(values[0]);
  const sourceHeaders = trimmedHeaders(values[0]);
  const indexes = new Map(sourceHeaders.map((header, index) => [header, index]));
  const sourceFor = (header) => (version === 'legacy23' ? LEGACY_TO_FINAL[header] : header);
  return [
    [...FINAL_HEADERS],
    ...values.slice(1).map((row) => FINAL_HEADERS.map((header) => row[indexes.get(sourceFor(header))] ?? '')),
  ];
}

function snapshotIds(values = [], label = 'aba') {
  const ids = values.slice(1).map((row) => String(row[0] ?? '').trim()).filter(Boolean);
  if (new Set(ids).size !== ids.length) throw new Error(`${label} contém Lead IDs duplicados.`);
  return ids;
}

function normalizedGrid(values = [], width) {
  return values.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ''));
}

export function validateSafetySnapshots({ leadsValues, historyValues, miniValues }) {
  const historyIds = snapshotIds(historyValues, HISTORY_SHEET);
  if (historyIds.length !== EXPECTED_HISTORY_COUNT) {
    throw new Error(`${HISTORY_SHEET} deve conter exatamente ${EXPECTED_HISTORY_COUNT} contatos antes da migração.`);
  }
  const miniRows = miniValues.slice(1).filter((row) => row.some((value) => String(value ?? '').trim() !== ''));
  if (miniRows.length) throw new Error(`${MINI_SHEET} contém registros e não pode ser removida automaticamente.`);
  return { leadIds: snapshotIds(leadsValues, 'Leads'), historyIds, miniRows: 0 };
}

function stringCell(value) {
  return { userEnteredValue: { stringValue: String(value ?? '') } };
}

function rowsFor(values) {
  return values.map((row) => ({ values: row.map(stringCell) }));
}

function dashboardTargets(values = []) {
  return Object.entries(DASHBOARD_FORMULAS).map(([label, formula]) => {
    const matches = [];
    values.forEach((row, rowIndex) => row.forEach((value, columnIndexValue) => {
      if (value === label) matches.push({ rowIndex, columnIndex: columnIndexValue });
    }));
    if (matches.length !== 1) throw new Error(`Indicador ${label} não encontrado uma única vez na Visão geral.`);
    const labelCell = matches[0];
    const candidates = [
      { rowIndex: labelCell.rowIndex + 1, columnIndex: labelCell.columnIndex },
      { rowIndex: labelCell.rowIndex, columnIndex: labelCell.columnIndex + 1 },
    ].filter(({ rowIndex, columnIndex: candidateColumn }) => {
      const value = values[rowIndex]?.[candidateColumn];
      return typeof value === 'string' && value.startsWith('=');
    });
    if (candidates.length !== 1) throw new Error(`Fórmula adjacente ao indicador ${label} não encontrada.`);
    return { ...candidates[0], formula };
  });
}

function buildRequests({ sheetsByTitle, transformedLeads, dashboardValues }) {
  const requests = [];
  const finalColumnCount = FINAL_HEADERS.length;
  const leads = sheetsByTitle.get('Leads');
  requests.push({
    updateCells: {
      rows: rowsFor(transformedLeads),
      range: {
        sheetId: leads.properties.sheetId, startRowIndex: 0, endRowIndex: transformedLeads.length,
        startColumnIndex: 0, endColumnIndex: finalColumnCount,
      },
      fields: 'userEnteredValue',
    },
  });

  for (const title of ['Qualificados', 'Desqualificados']) {
    const sheet = sheetsByTitle.get(title);
    requests.push({
      repeatCell: {
        cell: {},
        range: {
          sheetId: sheet.properties.sheetId, startRowIndex: 0,
          endRowIndex: sheet.properties.gridProperties.rowCount, startColumnIndex: 0,
          endColumnIndex: sheet.properties.gridProperties.columnCount,
        },
        fields: 'userEnteredValue',
      },
    });
    requests.push({
      updateCells: {
        rows: rowsFor([FINAL_HEADERS]),
        range: { sheetId: sheet.properties.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: finalColumnCount },
        fields: 'userEnteredValue',
      },
    });
    requests.push({
      updateCells: {
        rows: [{ values: [{ userEnteredValue: { formulaValue: DERIVED_VIEW_FORMULAS[title] } }] }],
        range: { sheetId: sheet.properties.sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 1 },
        fields: 'userEnteredValue',
      },
    });
  }

  const dashboardSheet = sheetsByTitle.get('Visão geral');
  dashboardTargets(dashboardValues).forEach(({ rowIndex, columnIndex: targetColumn, formula }) => {
    requests.push({
      updateCells: {
        rows: [{ values: [{ userEnteredValue: { formulaValue: formula } }] }],
        range: {
          sheetId: dashboardSheet.properties.sheetId, startRowIndex: rowIndex, endRowIndex: rowIndex + 1,
          startColumnIndex: targetColumn, endColumnIndex: targetColumn + 1,
        },
        fields: 'userEnteredValue',
      },
    });
  });

  for (const title of ['Leads', 'Qualificados', 'Desqualificados']) {
    const sheet = sheetsByTitle.get(title);
    requests.push({
      setBasicFilter: { filter: { range: { sheetId: sheet.properties.sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: finalColumnCount } } },
    });
    requests.push({
      updateSheetProperties: {
        properties: { sheetId: sheet.properties.sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount',
      },
    });
    const columnCount = sheet.properties.gridProperties.columnCount;
    if (columnCount > finalColumnCount) {
      requests.push({
        deleteDimension: {
          range: { sheetId: sheet.properties.sheetId, dimension: 'COLUMNS', startIndex: finalColumnCount, endIndex: columnCount },
        },
      });
    }
  }
  requests.push({ deleteSheet: { sheetId: sheetsByTitle.get(MINI_SHEET).properties.sheetId } });
  return requests;
}

function readConfiguration(environment) {
  const spreadsheetId = environment.GOOGLE_SHEET_ID?.trim();
  const clientEmail = environment.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = environment.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!spreadsheetId || !clientEmail || !privateKey) throw new Error('As variáveis do Google Sheets não estão configuradas.');
  if (spreadsheetId !== EXPECTED_SPREADSHEET_ID) throw new Error('GOOGLE_SHEET_ID não corresponde à planilha autorizada.');
  return { spreadsheetId, clientEmail, privateKey };
}

async function createClient(configuration) {
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: configuration.clientEmail, private_key: configuration.privateKey },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

const READ_RANGES = [
  "'Leads'!A1:W", "'Qualificados'!A1:W1", "'Desqualificados'!A1:W1",
  "'Visão geral'!A1:Z100", `'${HISTORY_SHEET}'!A1:W`, `'${MINI_SHEET}'!A1:R`,
];

async function readWorkbook(sheets, spreadsheetId) {
  const response = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges: READ_RANGES, valueRenderOption: 'FORMULA' });
  const ranges = response.data.valueRanges ?? [];
  if (ranges.length !== READ_RANGES.length) throw new Error('Não foi possível validar todas as faixas da planilha.');
  return ranges.map((range) => range.values ?? []);
}

function assertBackupMatches(sourceRanges, backupRanges) {
  if (JSON.stringify(sourceRanges) !== JSON.stringify(backupRanges)) {
    throw new Error('O backup informado não corresponde ao estado atual da planilha de produção.');
  }
}

export async function runMigration({ dryRun = false, environment = process.env, sheetsClient } = {}) {
  if (!dryRun) {
    if (environment.CONFIRM_SHEET_MIGRATION !== 'true') throw new Error('Migração bloqueada: defina CONFIRM_SHEET_MIGRATION=true.');
    if (environment.CONFIRM_SHEET_BACKUP_VERIFIED !== 'true') throw new Error('Migração bloqueada: confirme o backup com CONFIRM_SHEET_BACKUP_VERIFIED=true.');
    if (!environment.GOOGLE_SHEET_BACKUP_ID || environment.GOOGLE_SHEET_BACKUP_ID === EXPECTED_SPREADSHEET_ID) {
      throw new Error('Migração bloqueada: informe um GOOGLE_SHEET_BACKUP_ID separado da produção.');
    }
  }

  const configuration = readConfiguration(environment);
  const sheets = sheetsClient ?? await createClient(configuration);
  const metadataResponse = await sheets.spreadsheets.get({
    spreadsheetId: configuration.spreadsheetId,
    fields: 'sheets(properties(sheetId,title,gridProperties),basicFilter)',
  });
  const sheetsByTitle = new Map((metadataResponse.data.sheets ?? []).map((sheet) => [sheet.properties.title, sheet]));
  const missingSheets = REQUIRED_SHEETS.filter((title) => !sheetsByTitle.has(title));
  if (missingSheets.length) throw new Error(`Abas obrigatórias ausentes: ${missingSheets.join(', ')}.`);

  const sourceRanges = await readWorkbook(sheets, configuration.spreadsheetId);
  const [leadsValues, qualifiedValues, disqualifiedValues, dashboardValues, historyValues, miniValues] = sourceRanges;
  identifyHeaderVersion(leadsValues[0]);
  identifyHeaderVersion(qualifiedValues[0]);
  identifyHeaderVersion(disqualifiedValues[0]);
  const safety = validateSafetySnapshots({ leadsValues, historyValues, miniValues });
  const transformedLeads = transformLeadValues(leadsValues);
  const summary = {
    dryRun,
    rows: safety.leadIds.length,
    historyRows: safety.historyIds.length,
    miniRows: safety.miniRows,
    currentColumns: trimmedHeaders(leadsValues[0]).length,
    finalColumns: FINAL_HEADERS.length,
    removedHeaders: [...REMOVED_HEADERS],
    removedSheet: MINI_SHEET,
    verifiedSheets: [...REQUIRED_SHEETS],
  };
  if (dryRun) return summary;

  const backupRanges = await readWorkbook(sheets, environment.GOOGLE_SHEET_BACKUP_ID);
  assertBackupMatches(sourceRanges, backupRanges);

  const requests = buildRequests({ sheetsByTitle, transformedLeads, dashboardValues });
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: configuration.spreadsheetId, requestBody: { requests } });

  const verification = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: configuration.spreadsheetId,
    ranges: ["'Leads'!A1:R", "'Qualificados'!A1:R1", "'Desqualificados'!A1:R1", `'${HISTORY_SHEET}'!A1:W`],
    valueRenderOption: 'FORMULA',
  });
  const verified = verification.data.valueRanges ?? [];
  for (let index = 0; index < 3; index += 1) {
    if (!sameHeaders(trimmedHeaders(verified[index]?.values?.[0] ?? []), FINAL_HEADERS)) {
      throw new Error('A verificação final dos cabeçalhos de 18 colunas falhou.');
    }
  }
  const finalLeadIds = snapshotIds(verified[0]?.values ?? [], 'Leads');
  const finalHistoryIds = snapshotIds(verified[3]?.values ?? [], HISTORY_SHEET);
  if (JSON.stringify(finalLeadIds) !== JSON.stringify(safety.leadIds)) throw new Error('Os Lead IDs de Leads mudaram durante a migração.');
  if (JSON.stringify(finalHistoryIds) !== JSON.stringify(safety.historyIds)) throw new Error('O histórico de 52 contatos mudou durante a migração.');
  if (JSON.stringify(normalizedGrid(verified[0]?.values ?? [], FINAL_HEADERS.length))
    !== JSON.stringify(normalizedGrid(transformedLeads, FINAL_HEADERS.length))) {
    throw new Error('Os dados operacionais não correspondem à transformação planejada.');
  }
  if (JSON.stringify(normalizedGrid(verified[3]?.values ?? [], LEGACY_HEADERS.length))
    !== JSON.stringify(normalizedGrid(historyValues, LEGACY_HEADERS.length))) {
    throw new Error('O conteúdo integral do histórico mudou durante a migração.');
  }

  const finalMetadata = await sheets.spreadsheets.get({
    spreadsheetId: configuration.spreadsheetId,
    fields: 'sheets(properties(title,gridProperties(columnCount)))',
  });
  const finalSheets = new Map((finalMetadata.data.sheets ?? []).map((sheet) => [sheet.properties.title, sheet]));
  if (['Leads', 'Qualificados', 'Desqualificados'].some((title) => finalSheets.get(title)?.properties.gridProperties.columnCount !== FINAL_HEADERS.length)) {
    throw new Error('A verificação final da quantidade de colunas falhou.');
  }
  if (finalSheets.has(MINI_SHEET)) throw new Error(`${MINI_SHEET} ainda existe após a migração.`);
  return { ...summary, dryRun: false, migrated: true, backupVerified: true, historyPreserved: true };
}

function printSummary(summary) {
  console.log(`Modo: ${summary.dryRun ? 'dry-run' : 'migração confirmada'}`);
  console.log(`Leads operacionais: ${summary.rows}`);
  console.log(`Contatos históricos preservados: ${summary.historyRows}`);
  console.log(`Registros em Leads — Mini: ${summary.miniRows}`);
  console.log(`Colunas atuais: ${summary.currentColumns}`);
  console.log(`Colunas finais: ${summary.finalColumns}`);
  console.log(`Aba a remover após backup verificado: ${summary.removedSheet}`);
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  runMigration({ dryRun: process.argv.includes('--dry-run') })
    .then(printSummary)
    .catch((error) => {
      console.error(`Migração abortada: ${error.message}`);
      process.exitCode = 1;
    });
}
