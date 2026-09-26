export const LEAD_HEADERS = Object.freeze([
  'Lead ID',
  'Data de criação',
  'Status',
  'Nome',
  'WhatsApp',
  'E-mail',
  'Situação atual',
  'Faixa de renda',
  'Faixa de pensão alimentícia',
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

export const LEAD_COLUMNS = Object.freeze({
  leadId: 0,
  createdAt: 1,
  status: 2,
  name: 3,
  phone: 4,
  email: 5,
  situation: 6,
  income: 7,
  pensionRange: 8,
  urgency: 9,
  hiring: 10,
  reason: 11,
  completedAt: 12,
  dataConsent: 13,
  contactConsent: 14,
  utmSource: 15,
  utmMedium: 16,
  utmCampaign: 17,
  utmContent: 18,
  utmTerm: 19,
  fbclid: 20,
  entryUrl: 21,
  device: 22,
});

export const COLUMN_COUNT = LEAD_HEADERS.length;
export const LEAD_SHEET_NAME = 'Leads';
export const LEAD_LAST_COLUMN = 'W';
export const LEAD_HEADER_RANGE = `'${LEAD_SHEET_NAME}'!A1:${LEAD_LAST_COLUMN}1`;
export const LEAD_DATA_RANGE = `'${LEAD_SHEET_NAME}'!A2:${LEAD_LAST_COLUMN}`;

export function hasCanonicalLeadHeaders(headers) {
  return Array.isArray(headers)
    && headers.length === COLUMN_COUNT
    && LEAD_HEADERS.every((header, index) => headers[index] === header);
}

export function assertCanonicalLeadRow(row) {
  if (!Array.isArray(row) || row.length !== COLUMN_COUNT) {
    throw new TypeError(`A linha do lead deve conter exatamente ${COLUMN_COUNT} células.`);
  }
  return row;
}

export function normalizeLeadRow(row = []) {
  if (!Array.isArray(row) || row.length > COLUMN_COUNT) {
    throw new TypeError(`A linha lida deve conter no máximo ${COLUMN_COUNT} células.`);
  }
  return Array.from({ length: COLUMN_COUNT }, (_, index) => row[index] ?? '');
}
