import { google } from 'googleapis';
import {
  assertCanonicalLeadRow,
  hasCanonicalLeadHeaders,
  LEAD_DATA_RANGE,
  LEAD_HEADER_RANGE,
  LEAD_LAST_COLUMN,
  LEAD_SHEET_NAME,
  normalizeLeadRow,
} from './leadSchema.js';

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

  if (!spreadsheetId || !clientEmail || !privateKey) {
    throw new GoogleSheetsError('A integração com Google Sheets não está configurada.');
  }

  return { spreadsheetId, clientEmail, privateKey };
}

export function createGoogleSheetsRepository({ environment = process.env, sheetsClient } = {}) {
  let client = sheetsClient;
  let spreadsheetId;
  let schemaValidation;

  async function getClient() {
    if (client && spreadsheetId) return { client, spreadsheetId };
    const configuration = readConfiguration(environment);
    spreadsheetId = configuration.spreadsheetId;

    if (!client) {
      const auth = new google.auth.GoogleAuth({
        credentials: {
          client_email: configuration.clientEmail,
          private_key: configuration.privateKey,
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
      client = google.sheets({ version: 'v4', auth });
    }
    return { client, spreadsheetId };
  }

  async function execute(operation) {
    try {
      return await operation(await getClient());
    } catch (error) {
      if (error instanceof GoogleSheetsError) throw error;
      throw new GoogleSheetsError('Não foi possível concluir a operação no Google Sheets.', error);
    }
  }

  async function ensureCanonicalSchema({ client: sheets, spreadsheetId: id }) {
    if (!schemaValidation) {
      schemaValidation = sheets.spreadsheets.values.get({
        spreadsheetId: id,
        range: LEAD_HEADER_RANGE,
      }).then((response) => {
        const headers = response.data.values?.[0] ?? [];
        if (!hasCanonicalLeadHeaders(headers)) {
          throw new GoogleSheetsError(
            'O cabeçalho da aba Leads não corresponde ao schema esperado de 23 colunas.',
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

  return {
    async append(row) {
      return execute(async (context) => {
        await ensureCanonicalSchema(context);
        assertCanonicalLeadRow(row);
        const { client: sheets, spreadsheetId: id } = context;
        const response = await sheets.spreadsheets.values.append({
          spreadsheetId: id,
          range: LEAD_DATA_RANGE,
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: [row] },
        });
        if (response.data.updates?.updatedRows !== 1) {
          throw new GoogleSheetsError('O Google Sheets não confirmou a criação do lead.');
        }
      });
    },

    async findByLeadId(leadId) {
      return execute(async (context) => {
        await ensureCanonicalSchema(context);
        const { client: sheets, spreadsheetId: id } = context;
        const response = await sheets.spreadsheets.values.get({ spreadsheetId: id, range: LEAD_DATA_RANGE });
        const rows = response.data.values ?? [];
        const index = rows.findIndex((row) => row[0] === leadId);
        if (index === -1) return null;
        return { rowNumber: index + 2, row: normalizeLeadRow(rows[index]) };
      });
    },

    async update(rowNumber, row) {
      return execute(async (context) => {
        await ensureCanonicalSchema(context);
        assertCanonicalLeadRow(row);
        const { client: sheets, spreadsheetId: id } = context;
        const response = await sheets.spreadsheets.values.update({
          spreadsheetId: id,
          range: `'${LEAD_SHEET_NAME}'!A${rowNumber}:${LEAD_LAST_COLUMN}${rowNumber}`,
          valueInputOption: 'RAW',
          requestBody: { values: [row] },
        });
        if (response.data.updatedRows !== 1) {
          throw new GoogleSheetsError('O Google Sheets não confirmou a atualização do lead.');
        }
      });
    },
  };
}
