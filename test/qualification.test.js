import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyLead } from '../server/qualification.js';

const situations = [
  'protective_order_received', 'protective_order_requested',
  'protective_order_possible', 'information_only',
];
const concerns = [
  'restrictions_and_consequences', 'how_to_act_and_rights',
  'situation_getting_worse', 'understand_how_it_works',
];
const intents = ['asap', 'within_7_days', 'evaluating', 'not_hiring_now'];
const payments = ['cash', 'installments_500', 'needs_values', 'not_available'];
const base = { legalSituation: 'protective_order_received', primaryConcern: concerns[0],
  hiringIntent: 'asap', paymentMethod: 'cash' };

function expectedStatus({ legalSituation, hiringIntent, paymentMethod }) {
  if (legalSituation === 'information_only' || hiringIntent === 'not_hiring_now'
    || paymentMethod === 'not_available') return 'Desqualificado';
  if (paymentMethod === 'needs_values') return 'Pendente de qualificação financeira';
  return 'Qualificado';
}

test('matriz completa classifica deterministicamente as 256 combinações', () => {
  let count = 0;
  for (const legalSituation of situations) for (const primaryConcern of concerns) {
    for (const hiringIntent of intents) for (const paymentMethod of payments) {
      const answers = { legalSituation, primaryConcern, hiringIntent, paymentMethod };
      assert.equal(classifyLead(answers).status, expectedStatus(answers));
      count += 1;
    }
  }
  assert.equal(count, 256);
});

test('a preocupação não interfere na classificação', () => {
  assert.deepEqual(concerns.map((primaryConcern) => classifyLead({ ...base, primaryConcern }).status),
    concerns.map(() => 'Qualificado'));
});

test('prioridades existem somente para qualificados e seguem a intenção', () => {
  assert.deepEqual(
    ['asap', 'within_7_days', 'evaluating'].map((hiringIntent) => (
      classifyLead({ ...base, hiringIntent, paymentMethod: 'installments_500' }).priorityCode
    )),
    ['high', 'medium', 'low'],
  );
  for (const answers of [
    { ...base, legalSituation: 'information_only' },
    { ...base, hiringIntent: 'not_hiring_now' },
    { ...base, paymentMethod: 'not_available' },
    { ...base, paymentMethod: 'needs_values' },
  ]) {
    const result = classifyLead(answers);
    assert.equal(result.priorityCode, null);
    assert.equal(result.priority, '');
    assert.equal(result.urgency, 'Sem prioridade comercial');
  }
});

test('critérios de desqualificação prevalecem sobre pendência financeira', () => {
  for (const answers of [
    { ...base, legalSituation: 'information_only', paymentMethod: 'needs_values' },
    { ...base, hiringIntent: 'not_hiring_now', paymentMethod: 'needs_values' },
    { ...base, paymentMethod: 'not_available' },
  ]) assert.equal(classifyLead(answers).status, 'Desqualificado');
});

test('necessidade de conhecer valores fica pendente e sem prioridade', () => {
  const result = classifyLead({ ...base, paymentMethod: 'needs_values' });
  assert.deepEqual([result.status, result.priorityCode],
    ['Pendente de qualificação financeira', null]);
  assert.match(result.reason, /não confirmada/u);
});

test('possibilidade de medida permanece potencial e não altera a prioridade', () => {
  const result = classifyLead({ ...base, legalSituation: 'protective_order_possible', hiringIntent: 'within_7_days' });
  assert.deepEqual([result.status, result.priorityCode, result.urgency], ['Qualificado', 'medium', 'Média']);
});

test('rejeita códigos desconhecidos', () => {
  assert.throws(() => classifyLead({ ...base, legalSituation: 'x' }), /inválido/u);
  assert.throws(() => classifyLead({ ...base, hiringIntent: 'x' }), /inválido/u);
  assert.throws(() => classifyLead({ ...base, paymentMethod: 'x' }), /inválido/u);
});
