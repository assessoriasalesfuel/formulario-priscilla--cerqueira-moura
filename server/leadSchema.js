export const LEAD_HEADERS = Object.freeze([
  'Lead ID',
  'Data de criação',
  'Status',
  'Tempo desde a medida protetiva',
  'Disponibilidade para investir',
  'WhatsApp',
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
  measureTime: 3,
  investment: 4,
  phone: 5,
  reason: 6,
  completedAt: 7,
  dataConsent: 8,
  contactConsent: 9,
  utmSource: 10,
  utmMedium: 11,
  utmCampaign: 12,
  utmContent: 13,
  utmTerm: 14,
  fbclid: 15,
  entryUrl: 16,
  device: 17,
});

export const COLUMN_COUNT = LEAD_HEADERS.length;
export const LEAD_SHEET_NAME = 'Leads';
export const LEAD_LAST_COLUMN = 'R';
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
