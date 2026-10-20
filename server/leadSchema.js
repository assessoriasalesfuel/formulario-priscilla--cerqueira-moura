export const LEAD_FIELDS = Object.freeze([
  ['leadId', 'Lead ID'],
  ['createdAt', 'Data de entrada'],
  ['name', 'Nome completo'],
  ['phone', 'WhatsApp'],
  ['status', 'Status de qualificação'],
  ['priority', 'Prioridade'],
  ['operationalUrgency', 'Urgência'],
  ['legalSituation', 'Situação atual'],
  ['caseAwarenessTime', 'Tempo desde a ciência do caso'],
  ['lawyerSituation', 'Situação com advogado'],
  ['hiringIntent', 'Intenção de contratação'],
  ['financialAvailability', 'Disponibilidade para contratação'],
  ['classificationReason', 'Motivo da classificação'],
  ['contactConsent', 'Autorização de contato'],
  ['privacyAcknowledged', 'Ciência do aviso de privacidade'],
  ['privacyNoticeVersion', 'Versão do aviso de privacidade'],
  ['utmSource', 'UTM Source'],
  ['utmMedium', 'UTM Medium'],
  ['utmCampaign', 'UTM Campaign'],
  ['utmContent', 'UTM Content'],
  ['utmTerm', 'UTM Term'],
  ['fbclid', 'FBCLID'],
  ['entryUrl', 'URL de entrada'],
  ['device', 'Dispositivo'],
]);

export const LEAD_HEADERS = Object.freeze(LEAD_FIELDS.map(([, header]) => header));
export const LEAD_COLUMNS = Object.freeze(Object.fromEntries(
  LEAD_FIELDS.map(([key], index) => [key, index]),
));
export const COLUMN_COUNT = LEAD_HEADERS.length;
export const LEAD_SHEET_NAME = 'Leads';
export const LEAD_LAST_COLUMN = 'X';
export const LEAD_HEADER_RANGE = `'${LEAD_SHEET_NAME}'!A1:${LEAD_LAST_COLUMN}1`;
export const LEAD_DATA_RANGE = `'${LEAD_SHEET_NAME}'!A2:${LEAD_LAST_COLUMN}`;
export const LEAD_APPEND_RANGE = LEAD_HEADER_RANGE;

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
