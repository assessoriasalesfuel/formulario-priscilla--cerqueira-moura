import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePriority, classifyLead } from '../public/js/qualification.js';

const qualifiedAnswers = {
  situation: 'protective_measure_received',
  income: 'from_6000_to_10000',
  hiring: 'ready_to_hire',
  urgency: 'no_official_deadline',
  dataConsent: true,
  contactConsent: true,
};

test('classifica lead qualificado', () => {
  assert.equal(classifyLead(qualifiedAnswers).classification, 'qualified');
});

test('faixa de pensão não altera a qualificação', () => {
  for (const pensionRange of ['not_paying', 'up_to_500', 'from_500_to_1500', 'above_1500']) {
    assert.deepEqual(
      classifyLead({ ...qualifiedAnswers, pensionRange }),
      classifyLead(qualifiedAnswers),
    );
  }
});

test('classifica familiar como qualificado', () => {
  const result = classifyLead({ ...qualifiedAnswers, situation: 'helping_family' });
  assert.equal(result.classification, 'qualified');
});

test('desqualifica situação diferente', () => {
  assert.equal(classifyLead({ ...qualifiedAnswers, situation: 'other_situation' }).classification, 'disqualified');
});

test('desqualifica quem ainda está pesquisando', () => {
  assert.equal(classifyLead({ ...qualifiedAnswers, hiring: 'researching' }).classification, 'disqualified');
});

test('desqualifica busca exclusiva por atendimento gratuito', () => {
  assert.equal(classifyLead({ ...qualifiedAnswers, hiring: 'free_only' }).classification, 'disqualified');
});

test('desqualifica renda de até R$ 3.000', () => {
  assert.equal(classifyLead({ ...qualifiedAnswers, income: 'up_to_3000' }).classification, 'disqualified');
});

test('qualifica renda intermediária somente com urgência e contratação imediata', () => {
  assert.equal(classifyLead({
    ...qualifiedAnswers,
    income: 'from_3000_to_6000',
    urgency: 'deadline_7d',
    hiring: 'ready_to_hire',
  }).classification, 'qualified');
  assert.equal(classifyLead({
    ...qualifiedAnswers,
    income: 'from_3000_to_6000',
    urgency: 'no_official_deadline',
  }).classification, 'disqualified');
});

test('calcula prioridade urgente', () => {
  for (const urgency of ['deadline_48h', 'deadline_7d', 'breach_accusation']) {
    assert.equal(calculatePriority(urgency), 'urgent');
  }
});

test('calcula prioridade alta', () => {
  assert.equal(calculatePriority('active_unknown_deadline'), 'high');
});

test('calcula prioridade normal', () => {
  assert.equal(calculatePriority('no_official_deadline'), 'normal');
  assert.equal(calculatePriority('unknown'), 'normal');
});

test('retorna objeto previsível com razão de urgência', () => {
  assert.deepEqual(classifyLead({ ...qualifiedAnswers, urgency: 'deadline_48h' }), {
    classification: 'qualified',
    priority: 'urgent',
    reason: 'Prazo ou situação urgente e disponibilidade para atendimento particular',
  });
});
