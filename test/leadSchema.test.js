import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCanonicalLeadRow,
  COLUMN_COUNT,
  hasCanonicalLeadHeaders,
  LEAD_COLUMNS,
  LEAD_DATA_RANGE,
  LEAD_HEADERS,
  normalizeLeadRow,
} from '../server/leadSchema.js';

test('schema canônico define exatamente 23 colunas de A até W', () => {
  assert.equal(COLUMN_COUNT, 23);
  assert.equal(LEAD_HEADERS.length, 23);
  assert.equal(LEAD_DATA_RANGE, "'Leads'!A2:W");
  assert.deepEqual(LEAD_COLUMNS, {
    leadId: 0, createdAt: 1, status: 2, name: 3, phone: 4, email: 5,
    situation: 6, income: 7, pensionRange: 8, urgency: 9, hiring: 10, reason: 11,
    completedAt: 12, dataConsent: 13, contactConsent: 14,
    utmSource: 15, utmMedium: 16, utmCampaign: 17, utmContent: 18, utmTerm: 19,
    fbclid: 20, entryUrl: 21, device: 22,
  });
});

test('validação exige cabeçalhos na ordem canônica', () => {
  assert.equal(hasCanonicalLeadHeaders(LEAD_HEADERS), true);
  const shifted = [...LEAD_HEADERS];
  [shifted[3], shifted[4]] = [shifted[4], shifted[3]];
  assert.equal(hasCanonicalLeadHeaders(shifted), false);
  assert.equal(hasCanonicalLeadHeaders([...LEAD_HEADERS, 'Extra']), false);
});

test('linhas de escrita exigem 23 células e leituras são normalizadas sem truncar excesso', () => {
  assert.equal(assertCanonicalLeadRow(Array(23).fill('')).length, 23);
  assert.throws(() => assertCanonicalLeadRow(Array(22).fill('')), /23 células/u);
  assert.throws(() => assertCanonicalLeadRow(Array(30).fill('')), /23 células/u);
  assert.equal(normalizeLeadRow(['id']).length, 23);
  assert.throws(() => normalizeLeadRow(Array(30).fill('')), /no máximo 23/u);
});
