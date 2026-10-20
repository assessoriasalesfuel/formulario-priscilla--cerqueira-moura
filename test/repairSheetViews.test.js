import test from 'node:test';
import assert from 'node:assert/strict';
import { LEAD_HEADERS } from '../server/leadSchema.js';
import {
  assertLeadSnapshotsEqual, createLeadSnapshot, DASHBOARD_FORMULAS,
  DERIVED_VIEW_FORMULAS, findDashboardFormulaTargets,
} from '../scripts/repairSheetViews.js';

function row(id, status) { const values = Array(24).fill(''); values[0] = id; values[4] = status; return values; }

test('fórmulas das visões usam A:X, status em E e incluem pendentes em Desqualificados', () => {
  assert.equal(LEAD_HEADERS.length, 24);
  assert.equal(Object.keys(DASHBOARD_FORMULAS).length + Object.keys(DERIVED_VIEW_FORMULAS).length, 6);
  assert.deepEqual(Object.keys(DASHBOARD_FORMULAS), ['TOTAL DE LEADS', 'QUALIFICADOS', 'DESQUALIFICADOS', 'TAXA DE QUALIFICAÇÃO']);
  assert.equal(Object.keys(DERIVED_VIEW_FORMULAS).length, 2);
  for (const formula of Object.values(DERIVED_VIEW_FORMULAS)) {
    assert.match(formula, /Leads!A2:X/u);
    assert.match(formula, /Leads!E2:E/u);
  }
  assert.match(DERIVED_VIEW_FORMULAS.Desqualificados, /Pendente de qualificação financeira/u);
  assert.match(DASHBOARD_FORMULAS['TAXA DE QUALIFICAÇÃO'], /Qualificado.*COUNTA/u);
});

test('snapshot separa os três status e detecta duplicidades', () => {
  const snapshot = createLeadSnapshot([
    row('q', 'Qualificado'), row('p', 'Pendente de qualificação financeira'),
    row('d', 'Desqualificado'),
  ]);
  assert.deepEqual(snapshot.qualifiedIds, ['q']);
  assert.deepEqual(snapshot.pendingIds, ['p']);
  assert.deepEqual(snapshot.disqualifiedIds, ['d']);
  assert.deepEqual(snapshot.nonQualifiedIds, ['p', 'd']);
  assert.throws(() => createLeadSnapshot([row('x', 'Qualificado'), row('x', 'Desqualificado')]), /duplicados/u);
  assert.throws(() => createLeadSnapshot([row('r', 'Revisão necessária')]), /status inesperado/ui);
});

test('localiza exatamente quatro indicadores na Visão geral', () => {
  const grid = [];
  Object.entries(DASHBOARD_FORMULAS).forEach(([label, formula], index) => {
    grid[index * 2] = [label]; grid[index * 2 + 1] = [formula];
  });
  const targets = findDashboardFormulaTargets(grid);
  assert.equal(targets.length, 4);
  assert.ok(targets.every(({ range }) => range.startsWith("'Visão geral'!")));
});

test('preservação rejeita mudança em Lead IDs', () => {
  assert.throws(() => assertLeadSnapshotsEqual(createLeadSnapshot([row('1', 'Qualificado')]),
    createLeadSnapshot([row('2', 'Qualificado')])), /Lead IDs mudaram/u);
});
