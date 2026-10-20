import { google } from 'googleapis';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  assertCanonicalLeadRow,
  hasCanonicalLeadHeaders,
  LEAD_APPEND_RANGE,
  LEAD_HEADER_RANGE,
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

function readConfiguration(environment) {
  const spreadsheetId = environment.GOOGLE_SHEET_ID?.trim();
  const clientEmail = environment.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = environment.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const configuredCredentialsFile = environment.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  const credentialsFile = configuredCredentialsFile
    ? path.resolve(projectDirectory, configuredCredentialsFile)
    : undefined;
  if (!spreadsheetId || (!credentialsFile && (!clientEmail || !privateKey))) {
    throw new GoogleSheetsError('A integração com Google Sheets não está configurada.');
  }
  return { spreadsheetId, clientEmail, privateKey, credentialsFile };
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
          : { credentials: { client_email: configuration.clientEmail, private_key: configuration.privateKey } }),
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
      throw new GoogleSheetsError('Não foi possível concluir a operação no Google Sheets.', error);
    }
  }

  async function validateSchema({ client: sheets, spreadsheetId: id }) {
    if (!schemaValidation) {
      schemaValidation = sheets.spreadsheets.values.get({ spreadsheetId: id, range: LEAD_HEADER_RANGE })
        .then((response) => {
          if (!hasCanonicalLeadHeaders(response.data.values?.[0] ?? [])) {
            throw new GoogleSheetsError(
              'O cabeçalho da aba Leads não corresponde ao schema comercial esperado de 24 colunas.',
              undefined,
              'SHEETS_SCHEMA_MISMATCH',
            );
          }
        }).catch((error) => {
          schemaValidation = undefined;
          throw error;
        });
    }
    await schemaValidation;
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
        await validateSchema(context);
        const response = await context.client.spreadsheets.values.append({
          spreadsheetId: context.spreadsheetId,
          range: LEAD_APPEND_RANGE,
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: [recordToRow(record)] },
        });
        if (response.data.updates?.updatedRows !== 1) {
          throw new GoogleSheetsError('O Google Sheets não confirmou a criação do lead.');
        }
      });
    },
    findBySubmissionId,
  });
}
