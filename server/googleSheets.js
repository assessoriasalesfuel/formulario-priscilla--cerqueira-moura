import { google } from 'googleapis';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  assertCanonicalLeadRow,
  hasCanonicalLeadHeaders,
  LEAD_LAST_COLUMN,
  LEAD_HEADER_RANGE,
  LEAD_SHEET_NAME,
  normalizeLeadRow,
} from './leadSchema.js';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export class GoogleSheetsError extends Error {
  constructor(message, cause, code = 'SHEETS_UNAVAILABLE') {
    super(message, { cause });
    this.name = 'GoogleSheetsError';
    this.statusCode = 503;
    this.code = code;
  }
}

function safeGoogleSheetsError(error) {
  const status = error?.response?.status ?? error?.status;
  const code = error?.code;
  const message = String(error?.message ?? '').toLowerCase();
  if (status === 401 || message.includes('invalid_grant') || message.includes('invalid jwt')
    || message.includes('private key') || message.includes('decoder routines')) {
    return new GoogleSheetsError(
      'A autenticação da conta de serviço do Google Sheets falhou.',
      error,
      'SHEETS_AUTH_FAILED',
    );
  }
  if (status === 403) {
    return new GoogleSheetsError(
      'A conta de serviço não possui permissão para acessar a planilha.',
      error,
      'SHEETS_PERMISSION_DENIED',
    );
  }
  if (status === 404) {
    return new GoogleSheetsError(
      'A planilha configurada não foi encontrada.',
      error,
      'SHEETS_NOT_FOUND',
    );
  }
  if (['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes(code)) {
    return new GoogleSheetsError(
      'O servidor não conseguiu alcançar o Google Sheets.',
      error,
      'SHEETS_NETWORK_ERROR',
    );
  }
  return new GoogleSheetsError('Não foi possível concluir a operação no Google Sheets.', error);
}

function readConfiguration(environment) {
  const spreadsheetId = environment.GOOGLE_SHEET_ID?.trim();
  const clientEmail = environment.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = environment.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const encodedCredentials = environment.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  const configuredCredentialsFile = environment.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  const credentialsFile = configuredCredentialsFile
    ? path.resolve(projectDirectory, configuredCredentialsFile)
    : undefined;
  let credentials;
  if (encodedCredentials) {
    try {
      const parsed = JSON.parse(Buffer.from(encodedCredentials, 'base64').toString('utf8'));
      if (parsed.type !== 'service_account' || !parsed.client_email || !parsed.private_key) throw new Error('Invalid credentials');
      credentials = { client_email: parsed.client_email.trim(), private_key: parsed.private_key.replace(/\\n/g, '\n') };
    } catch (error) {
      throw new GoogleSheetsError(
        'A credencial Google codificada no ambiente é inválida.',
        error,
        'SHEETS_CONFIG_INVALID',
      );
    }
  } else if (clientEmail && privateKey) {
    credentials = { client_email: clientEmail, private_key: privateKey };
  }
  if (!spreadsheetId || (!credentialsFile && !credentials)) {
    throw new GoogleSheetsError('A integração com Google Sheets não está configurada.');
  }
  return { spreadsheetId, credentials, credentialsFile };
}

export function formatCrmDate(value, timeZone = 'America/Sao_Paulo') {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('Data de entrada inválida.');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).filter(({ type }) => type !== 'literal')
    .map(({ type, value: part }) => [type, part]));
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}`;
}

export function recordToRow(record) {
  return assertCanonicalLeadRow([
    record.leadId ?? '',
    formatCrmDate(record.createdAt),
    record.name ?? '',
    record.phone ?? '',
    record.status ?? '',
    record.priority ?? '',
    record.operationalUrgency ?? '',
    record.legalSituation ?? '',
    record.caseAwarenessTime ?? '',
    record.lawyerSituation ?? '',
    record.hiringIntent ?? '',
    record.financialAvailability ?? '',
    record.classificationReason ?? '',
    record.contactConsent ?? '',
    record.privacyAcknowledged ?? '',
    record.privacyNoticeVersion ?? '',
    record.utmSource ?? '',
    record.utmMedium ?? '',
    record.utmCampaign ?? '',
    record.utmContent ?? '',
    record.utmTerm ?? '',
    record.fbclid ?? '',
    record.entryUrl ?? '',
    record.device ?? '',
  ]);
}

function idempotencyRecord(leadId, values) {
  const [status = ''] = values;
  return {
    leadId,
    submissionId: leadId,
    status,
  };
}

export function createGoogleSheetsRepository({ environment = process.env, sheetsClient } = {}) {
  let client = sheetsClient;
  let spreadsheetId;
  let schemaValidation;

  async function getContext() {
    if (client && spreadsheetId) return { client, spreadsheetId };
    const configuration = readConfiguration(environment);
    spreadsheetId = configuration.spreadsheetId;
    if (!client) {
      const auth = new google.auth.GoogleAuth({
        ...(configuration.credentialsFile
          ? { keyFile: configuration.credentialsFile }
          : { credentials: configuration.credentials }),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      client = google.sheets({ version: 'v4', auth });
    }
    return { client, spreadsheetId };
  }

  async function execute(operation) {
    try {
      return await operation(await getContext());
    } catch (error) {
      if (error instanceof GoogleSheetsError) throw error;
      throw safeGoogleSheetsError(error);
    }
  }

  async function validateSchema({ client: sheets, spreadsheetId: id }) {
    if (!schemaValidation) {
      schemaValidation = Promise.all([
        sheets.spreadsheets.values.get({ spreadsheetId: id, range: LEAD_HEADER_RANGE }),
        sheets.spreadsheets.get({
          spreadsheetId: id,
          fields: 'sheets.properties(sheetId,title)',
        }),
      ]).then(([headerResponse, metadataResponse]) => {
          if (!hasCanonicalLeadHeaders(headerResponse.data.values?.[0] ?? [])) {
            throw new GoogleSheetsError(
              'O cabeçalho da aba Leads não corresponde ao schema comercial esperado de 24 colunas.',
              undefined,
              'SHEETS_SCHEMA_MISMATCH',
            );
          }
          const matches = (metadataResponse.data.sheets ?? [])
            .filter(({ properties }) => properties?.title === LEAD_SHEET_NAME);
          const sheetId = matches[0]?.properties?.sheetId;
          if (matches.length !== 1 || !Number.isInteger(sheetId)) {
            throw new GoogleSheetsError('A aba Leads não foi encontrada de forma única.', undefined, 'SHEETS_SCHEMA_MISMATCH');
          }
          return { sheetId };
        }).catch((error) => {
          schemaValidation = undefined;
          throw error;
        });
    }
    await schemaValidation;
    return schemaValidation;
  }

  async function verifyWrittenRow(context, expectedRow) {
    const idResponse = await context.client.spreadsheets.values.get({
      spreadsheetId: context.spreadsheetId,
      range: `'${LEAD_SHEET_NAME}'!A2:A`,
    });
    const matchingRows = (idResponse.data.values ?? [])
      .map((values, index) => ({ leadId: values[0], rowNumber: index + 2 }))
      .filter(({ leadId }) => leadId === expectedRow[0]);
    if (matchingRows.length !== 1) {
      throw new GoogleSheetsError(
        'O Google Sheets não confirmou o Lead ID uma única vez na coluna A.',
        undefined,
        'SHEETS_WRITE_MISMATCH',
      );
    }
    const rowNumber = matchingRows[0].rowNumber;
    const effectiveRange = `'${LEAD_SHEET_NAME}'!A${rowNumber}:${LEAD_LAST_COLUMN}${rowNumber}`;
    const rowResponse = await context.client.spreadsheets.values.get({
      spreadsheetId: context.spreadsheetId,
      range: effectiveRange,
      valueRenderOption: 'FORMATTED_VALUE',
    });
    const writtenRow = normalizeLeadRow(rowResponse.data.values?.[0] ?? []);
    if (JSON.stringify(writtenRow) !== JSON.stringify(expectedRow)) {
      throw new GoogleSheetsError(
        'A linha gravada no Google Sheets não corresponde ao contrato A:X.',
        undefined,
        'SHEETS_WRITE_MISMATCH',
      );
    }
    return { rowNumber, updatedRange: effectiveRange };
  }

  async function findBySubmissionId(submissionId) {
    return execute(async (context) => {
      await validateSchema(context);
      const idResponse = await context.client.spreadsheets.values.get({
        spreadsheetId: context.spreadsheetId,
        range: "'Leads'!A2:A",
      });
      const index = (idResponse.data.values ?? []).findIndex((row) => row[0] === submissionId);
      if (index < 0) return null;
      const rowNumber = index + 2;
      const recordResponse = await context.client.spreadsheets.values.get({
        spreadsheetId: context.spreadsheetId,
        range: `'Leads'!E${rowNumber}:E${rowNumber}`,
      });
      return {
        rowNumber,
        record: idempotencyRecord(submissionId, recordResponse.data.values?.[0] ?? []),
      };
    });
  }

  return Object.freeze({
    async verifyConnection() {
      return execute(async (context) => {
        await validateSchema(context);
        return true;
      });
    },
    async append(record) {
      return execute(async (context) => {
        const { sheetId } = await validateSchema(context);
        const row = recordToRow(record);
        await context.client.spreadsheets.batchUpdate({
          spreadsheetId: context.spreadsheetId,
          requestBody: {
            requests: [{
              appendCells: {
                sheetId,
                rows: [{
                  values: row.map((value) => ({ userEnteredValue: { stringValue: value } })),
                }],
                fields: 'userEnteredValue',
              },
            }],
          },
        });
        return verifyWrittenRow(context, row);
      });
    },
    findBySubmissionId,
  });
}
