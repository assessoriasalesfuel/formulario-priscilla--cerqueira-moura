import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyLead } from '../public/js/qualification.js';

const qualifiedAnswers = {
  measureTime: 'less_than_1_month',
  investment: 'can_invest',
  dataConsent: true,
  contactConsent: true,
};

test('qualifica todas as faixas de tempo quando há investimento', () => {
  for (const measureTime of ['less_than_1_month', 'from_1_to_3_months', 'from_3_to_6_months', 'more_than_6_months']) {
    assert.equal(classifyLead({ ...qualifiedAnswers, measureTime }).classification, 'qualified');
  }
});

test('qualifica quem precisa parcelar, mas consegue investir', () => {
  assert.equal(classifyLead({ ...qualifiedAnswers, investment: 'needs_installments' }).classification, 'qualified');
});

test('tempo superior a 6 meses não desqualifica', () => {
  const result = classifyLead({ ...qualifiedAnswers, measureTime: 'more_than_6_months' });
  assert.equal(result.classification, 'qualified');
});

test('desqualifica quem não consegue investir agora', () => {
  const result = classifyLead({ ...qualifiedAnswers, investment: 'cannot_invest_now' });
  assert.equal(result.classification, 'disqualified');
  assert.match(result.reason, /Sem disponibilidade/u);
});

test('classificação pura depende exclusivamente da disponibilidade de investimento', () => {
  assert.equal(classifyLead({ investment: 'can_invest' }).classification, 'qualified');
  assert.equal(classifyLead({ investment: 'needs_installments' }).classification, 'qualified');
  assert.equal(classifyLead({ investment: 'cannot_invest_now' }).classification, 'disqualified');
});

test('retorna classificação e motivo sem promessas jurídicas', () => {
  const result = classifyLead(qualifiedAnswers);
  assert.deepEqual(result, {
    classification: 'qualified',
    reason: 'Disponibilidade para investimento em defesa profissional',
  });
  assert.doesNotMatch(JSON.stringify(result), /revoga|garantia|resultado garantido/ui);
});
