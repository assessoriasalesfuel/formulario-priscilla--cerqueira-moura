import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCanonicalLeadRow, COLUMN_COUNT, hasCanonicalLeadHeaders, LEAD_COLUMNS,
  LEAD_APPEND_RANGE, LEAD_DATA_RANGE, LEAD_HEADERS, normalizeLeadRow } from '../server/leadSchema.js';

test('schema comercial define exatamente 24 colunas de A até X', () => {
  assert.equal(COLUMN_COUNT, 24);
  assert.equal(LEAD_HEADERS.length, 24);
  assert.equal(LEAD_DATA_RANGE, "'Leads'!A2:X");
  assert.equal(LEAD_APPEND_RANGE, "'Leads'!A1:X1");
  assert.deepEqual(LEAD_COLUMNS, {
    leadId: 0, createdAt: 1, name: 2, phone: 3, status: 4, priority: 5,
    operationalUrgency: 6, legalSituation: 7, caseAwarenessTime: 8, lawyerSituation: 9,
    hiringIntent: 10, financialAvailability: 11, classificationReason: 12,
    contactConsent: 13, privacyAcknowledged: 14, privacyNoticeVersion: 15,
    utmSource: 16, utmMedium: 17, utmCampaign: 18, utmContent: 19, utmTerm: 20, fbclid: 21,
    entryUrl: 22, device: 23,
  });
});

test('validação exige cabeçalhos na ordem canônica', () => {
  assert.equal(hasCanonicalLeadHeaders(LEAD_HEADERS), true);
  const shifted = [...LEAD_HEADERS];
  [shifted[3], shifted[4]] = [shifted[4], shifted[3]];
  assert.equal(hasCanonicalLeadHeaders(shifted), false);
  assert.equal(hasCanonicalLeadHeaders([...LEAD_HEADERS, 'Extra']), false);
});

test('linhas exigem 24 células e leituras são normalizadas', () => {
  assert.equal(assertCanonicalLeadRow(Array(24).fill('')).length, 24);
  assert.throws(() => assertCanonicalLeadRow(Array(23).fill('')), /24 células/u);
  assert.throws(() => assertCanonicalLeadRow(Array(25).fill('')), /24 células/u);
  assert.equal(normalizeLeadRow(['id']).length, 24);
  assert.throws(() => normalizeLeadRow(Array(25).fill('')), /no máximo 24/u);
});
