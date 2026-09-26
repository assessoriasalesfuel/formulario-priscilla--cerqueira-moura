import { google } from 'googleapis';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { LEAD_HEADERS } from '../server/leadSchema.js';
import { DERIVED_VIEW_FORMULAS } from '../server/sheetViewFormulas.js';

const EXPECTED_SPREADSHEET_ID = '1zzeazzXlD3XI1ZnTQoO9MX27DvqHlionTDPqhHA5UEA';
const REQUIRED_SHEETS = ['Leads', 'Qualificados', 'Desqualificados', 'Visão geral'];

export const FINAL_HEADERS = LEAD_HEADERS;

export const PREVIOUS_HEADERS = Object.freeze([
  'Lead ID',
  'Data de criação',
  'Status',
  'Nome',
  'WhatsApp',
  'E-mail',
  'Situação atual',
  'Principal preocupação',
  'Urgência',
  'Momento da contratação',
  'Motivo da classificação',
  'Data de conclusão',
  'Consentimento de dados',
  'Autorização de contato',
  'UTM Source',
  'UTM Medium',
  'UTM Campaign',
  'UTM Content',
  'UTM Term',
  'FBCLID',
  'URL de entrada',
  'Dispositivo',
]);

export const INCOME_HEADERS = Object.freeze([
  'Lead ID',
  'Data de criação',
  'Status',
  'Nome',
  'WhatsApp',
  'E-mail',
  'Situação atual',
  'Faixa de renda',
  'Urgência',
  'Momento da contratação',
  'Motivo da classificação',
  'Data de conclusão',
  'Consentimento de dados',
  'Autorização de contato',
  'UTM Source',
  'UTM Medium',
  'UTM Campaign',
  'UTM Content',
  'UTM Term',
  'FBCLID',
  'URL de entrada',
  'Dispositivo',
]);

export const OLD_HEADERS = Object.freeze([
  'Lead ID',
  'Data de criação',
  'Status',
  'Prioridade',
  'Nome',
  'WhatsApp',
  'E-mail',
  'DDD',
  'Situação atual',
  'Principal preocupação',
  'Urgência',
  'Momento da contratação',
  'Motivo da classificação',
  'Última etapa',
  'Última atualização',
  'Data de conclusão',
  'WhatsApp acessado',
  'Data do acesso ao WhatsApp',
  'Consentimento de dados',
  'Autorização de contato',
  'Data do consentimento',
  'UTM Source',
  'UTM Medium',
  'UTM Campaign',
  'UTM Content',
  'UTM Term',
  'FBCLID',
  'URL de entrada',
  'Referrer',
  'Dispositivo',
]);

export const REMOVED_HEADERS = Object.freeze(OLD_HEADERS.filter((header) => !FINAL_HEADERS.includes(header)));

function trimmedHeaders(row = []) {
  const headers = row.map((value) => String(value ?? '').trim());
  while (headers.at(-1) === '') headers.pop();
  return headers;
}

function sameHeaderSet(actual, expected) {
  return actual.length === expected.length
    && new Set(actual).size === actual.length
    && expected.every((header) => actual.includes(header));
}

export function identifyHeaderVersion(row) {
  const headers = trimmedHeaders(row);
  if (sameHeaderSet(headers, OLD_HEADERS)) return 'old';
  if (sameHeaderSet(headers, PREVIOUS_HEADERS)) return 'previous';
  if (sameHeaderSet(headers, INCOME_HEADERS)) return 'income';
  if (sameHeaderSet(headers, FINAL_HEADERS)) return 'final';
  throw new Error('A estrutura de cabeçalhos não corresponde a uma versão reconhecida.');
}

export function transformLeadValues(values = []) {
  if (!values.length) throw new Error('A aba Leads não possui cabeçalhos.');
  identifyHeaderVersion(values[0]);
  const sourceHeaders = trimmedHeaders(values[0]);
  const indexes = new Map(sourceHeaders.map((header, index) => [header, index]));
  return [
    [...FINAL_HEADERS],
    ...values.slice(1).map((row) => FINAL_HEADERS.map((header) => row[indexes.get(header)] ?? '')),
  ];
}

function stringCell(value) {
  return { userEnteredValue: { stringValue: String(value ?? '') } };
}

function rowsFor(values) {
  return values.map((row) => ({ values: row.map(stringCell) }));
}

function isPriorityRule(rule) {
  const ranges = rule.ranges ?? [];
  const onlyPriorityColumn = ranges.length > 0
    && ranges.every((range) => range.startColumnIndex === 3 && range.endColumnIndex === 4);
  const serialized = JSON.stringify(rule);
  const priorityFormula = /(?:\$D|D:D)/u.test(serialized) && /urgent|urgente|alta|normal/iu.test(serialized);
  return onlyPriorityColumn || priorityFormula;
}

function validateDashboard(values = []) {
  const formulas = values.flat().filter((value) => typeof value === 'string' && value.startsWith('='));
  const removedColumnReference = /Leads!\$?(?:D|H|N|O|Q|R|U|AC)(?::|\$?\d)/iu;
  if (formulas.some((formula) => removedColumnReference.test(formula))) {
    throw new Error('A aba Visão geral possui fórmula dependente de uma coluna que será removida.');
  }
  return formulas.length;
}

function buildRequests({ sheetsByTitle, transformedLeads, oldSchemaTitles }) {
  const requests = [];

  for (const title of ['Leads', 'Qualificados', 'Desqualificados']) {
    const sheet = sheetsByTitle.get(title);
    const missingColumns = FINAL_HEADERS.length - sheet.properties.gridProperties.columnCount;
    if (missingColumns > 0) {
      requests.push({
        appendDimension: {
          sheetId: sheet.properties.sheetId,
          dimension: 'COLUMNS',
          length: missingColumns,
        },
      });
    }
  }

  for (const title of ['Leads', 'Qualificados', 'Desqualificados']) {
    const sheet = sheetsByTitle.get(title);
    const priorityRuleIndexes = oldSchemaTitles.has(title) ? (sheet.conditionalFormats ?? [])
      .map((rule, index) => ({ rule, index }))
      .filter(({ rule }) => isPriorityRule(rule))
      .map(({ index }) => index)
      .sort((left, right) => right - left) : [];
    priorityRuleIndexes.forEach((index) => {
      requests.push({ deleteConditionalFormatRule: { sheetId: sheet.properties.sheetId, index } });
    });
  }

  const leads = sheetsByTitle.get('Leads');
  requests.push({
    updateCells: {
      rows: rowsFor(transformedLeads),
      range: {
        sheetId: leads.properties.sheetId,
        startRowIndex: 0,
        endRowIndex: transformedLeads.length,
        startColumnIndex: 0,
        endColumnIndex: FINAL_HEADERS.length,
      },
      fields: 'userEnteredValue',
    },
  });

  for (const title of ['Qualificados', 'Desqualificados']) {
    const sheet = sheetsByTitle.get(title);
    const sheetId = sheet.properties.sheetId;
    requests.push({
      repeatCell: {
        cell: {},
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: sheet.properties.gridProperties.rowCount,
          startColumnIndex: 0,
          endColumnIndex: FINAL_HEADERS.length,
        },
        fields: 'userEnteredValue',
      },
    });
    requests.push({
      updateCells: {
        rows: rowsFor([FINAL_HEADERS]),
        range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: FINAL_HEADERS.length },
        fields: 'userEnteredValue',
      },
    });
    requests.push({
      updateCells: {
        rows: [{ values: [{ userEnteredValue: { formulaValue: DERIVED_VIEW_FORMULAS[title] } }] }],
        range: { sheetId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 1 },
        fields: 'userEnteredValue',
      },
    });
  }

  for (const title of ['Leads', 'Qualificados', 'Desqualificados']) {
    const sheet = sheetsByTitle.get(title);
    const sheetId = sheet.properties.sheetId;
    requests.push({
      setBasicFilter: {
        filter: {
          ...(sheet.basicFilter ?? {}),
          range: { sheetId, startRowIndex: 0, startColumnIndex: 0, endColumnIndex: FINAL_HEADERS.length },
        },
      },
    });
    requests.push({
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount',
      },
    });
    const columnCount = sheet.properties.gridProperties.columnCount;
    if (columnCount > FINAL_HEADERS.length) {
      requests.push({
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'COLUMNS',
            startIndex: FINAL_HEADERS.length,
            endIndex: columnCount,
          },
        },
      });
    }
  }
  return requests;
}

function readConfiguration(environment) {
  const spreadsheetId = environment.GOOGLE_SHEET_ID?.trim();
  const clientEmail = environment.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = environment.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!spreadsheetId || !clientEmail || !privateKey) {
    throw new Error('As variáveis do Google Sheets não estão configuradas.');
  }
  if (spreadsheetId !== EXPECTED_SPREADSHEET_ID) {
    throw new Error('GOOGLE_SHEET_ID não corresponde à planilha autorizada para esta migração.');
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

export async function runMigration({ dryRun = false, environment = process.env, sheetsClient } = {}) {
  if (!dryRun && environment.CONFIRM_SHEET_MIGRATION !== 'true') {
    throw new Error('Migração bloqueada: defina CONFIRM_SHEET_MIGRATION=true para permitir alterações.');
  }
  const configuration = readConfiguration(environment);
  const sheets = sheetsClient ?? await createClient(configuration);
  const metadataResponse = await sheets.spreadsheets.get({
    spreadsheetId: configuration.spreadsheetId,
    fields: 'sheets(properties(sheetId,title,gridProperties),basicFilter,conditionalFormats)',
  });
  const sheetsByTitle = new Map((metadataResponse.data.sheets ?? []).map((sheet) => [sheet.properties.title, sheet]));
  const missingSheets = REQUIRED_SHEETS.filter((title) => !sheetsByTitle.has(title));
  if (missingSheets.length) throw new Error(`Abas obrigatórias ausentes: ${missingSheets.join(', ')}.`);

  const valuesResponse = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: configuration.spreadsheetId,
    ranges: ["'Leads'!A1:AD", "'Qualificados'!A1:AD", "'Desqualificados'!A1:AD", "'Visão geral'!A:Z"],
    valueRenderOption: 'FORMULA',
  });
  const ranges = valuesResponse.data.valueRanges ?? [];
  if (ranges.length !== 4) throw new Error('Não foi possível validar todas as abas da planilha.');
  const leadsValues = ranges[0].values ?? [];
  const headerVersions = new Map([
    ['Leads', identifyHeaderVersion(leadsValues[0])],
    ['Qualificados', identifyHeaderVersion((ranges[1].values ?? [])[0])],
    ['Desqualificados', identifyHeaderVersion((ranges[2].values ?? [])[0])],
  ]);
  const currentVersion = headerVersions.get('Leads');
  const dashboardFormulaCount = validateDashboard(ranges[3].values ?? []);
  const transformedLeads = transformLeadValues(leadsValues);

  const summary = {
    dryRun,
    rows: Math.max(0, transformedLeads.length - 1),
    currentColumns: currentVersion === 'old' ? OLD_HEADERS.length
      : currentVersion === 'final' ? FINAL_HEADERS.length : INCOME_HEADERS.length,
    finalColumns: FINAL_HEADERS.length,
    removedHeaders: [...REMOVED_HEADERS],
    verifiedSheets: [...REQUIRED_SHEETS],
    dashboardFormulaCount,
  };

  if (dryRun) return summary;

  const oldSchemaTitles = new Set(
    [...headerVersions.entries()].filter(([, version]) => version === 'old').map(([title]) => title),
  );
  const requests = buildRequests({ sheetsByTitle, transformedLeads, oldSchemaTitles });
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: configuration.spreadsheetId,
    requestBody: { requests },
  });

  const verification = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: configuration.spreadsheetId,
    ranges: [
      "'Leads'!A1:W1",
      "'Qualificados'!A1:W1",
      "'Desqualificados'!A1:W1",
      "'Qualificados'!A2",
      "'Desqualificados'!A2",
    ],
    valueRenderOption: 'FORMULA',
  });
  const verifiedRanges = verification.data.valueRanges ?? [];
  for (let index = 0; index < 3; index += 1) {
    const verifiedHeaders = trimmedHeaders((verifiedRanges[index]?.values ?? [])[0]);
    if (JSON.stringify(verifiedHeaders) !== JSON.stringify(FINAL_HEADERS)) {
      throw new Error('A verificação final dos cabeçalhos falhou.');
    }
  }
  if (verifiedRanges[3]?.values?.[0]?.[0] !== DERIVED_VIEW_FORMULAS.Qualificados
    || verifiedRanges[4]?.values?.[0]?.[0] !== DERIVED_VIEW_FORMULAS.Desqualificados) {
    throw new Error('A verificação final das fórmulas derivadas falhou.');
  }
  const finalMetadata = await sheets.spreadsheets.get({
    spreadsheetId: configuration.spreadsheetId,
    fields: 'sheets(properties(title,gridProperties(columnCount)))',
  });
  const finalColumnCounts = new Map(
    (finalMetadata.data.sheets ?? []).map((sheet) => [sheet.properties.title, sheet.properties.gridProperties.columnCount]),
  );
  if (['Leads', 'Qualificados', 'Desqualificados'].some((title) => finalColumnCounts.get(title) !== FINAL_HEADERS.length)) {
    throw new Error('A verificação final da quantidade de colunas falhou.');
  }
  return { ...summary, dryRun: false, migrated: true };
}

function printSummary(summary) {
  console.log(`Modo: ${summary.dryRun ? 'dry-run' : 'migração confirmada'}`);
  console.log(`Linhas processadas: ${summary.rows}`);
  console.log(`Colunas atuais: ${summary.currentColumns}`);
  console.log(`Colunas finais: ${summary.finalColumns}`);
  console.log(`Campos removidos: ${summary.removedHeaders.join(', ')}`);
  console.log(`Abas verificadas: ${summary.verifiedSheets.join(', ')}`);
  console.log(`Fórmulas validadas na Visão geral: ${summary.dashboardFormulaCount}`);
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
