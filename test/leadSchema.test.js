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

test('schema canônico define exatamente 18 colunas de A até R', () => {
  assert.equal(COLUMN_COUNT, 18);
  assert.equal(LEAD_HEADERS.length, 18);
  assert.equal(LEAD_DATA_RANGE, "'Leads'!A2:R");
  assert.deepEqual(LEAD_COLUMNS, {
    leadId: 0, createdAt: 1, status: 2, measureTime: 3, investment: 4, phone: 5,
    reason: 6, completedAt: 7, dataConsent: 8, contactConsent: 9,
    utmSource: 10, utmMedium: 11, utmCampaign: 12, utmContent: 13, utmTerm: 14,
    fbclid: 15, entryUrl: 16, device: 17,
  });
});

test('validação exige cabeçalhos na ordem canônica', () => {
  assert.equal(hasCanonicalLeadHeaders(LEAD_HEADERS), true);
  const shifted = [...LEAD_HEADERS];
  [shifted[3], shifted[4]] = [shifted[4], shifted[3]];
  assert.equal(hasCanonicalLeadHeaders(shifted), false);
  assert.equal(hasCanonicalLeadHeaders([...LEAD_HEADERS, 'Extra']), false);
});

test('linhas de escrita exigem 18 células e leituras são normalizadas sem truncar excesso', () => {
  assert.equal(assertCanonicalLeadRow(Array(18).fill('')).length, 18);
  assert.throws(() => assertCanonicalLeadRow(Array(17).fill('')), /18 células/u);
  assert.throws(() => assertCanonicalLeadRow(Array(23).fill('')), /18 células/u);
  assert.equal(normalizeLeadRow(['id']).length, 18);
  assert.throws(() => normalizeLeadRow(Array(23).fill('')), /no máximo 18/u);
});
