import test from 'node:test';
import assert from 'node:assert/strict';
import { questions } from '../public/js/questions.js';

test('pergunta de pensão fica entre renda e urgência', () => {
  const ids = questions.map(({ id }) => id);
  assert.equal(ids.indexOf('pensionRange'), ids.indexOf('income') + 1);
  assert.equal(ids.indexOf('urgency'), ids.indexOf('pensionRange') + 1);
});

test('pergunta de pensão possui texto e quatro opções exatos', () => {
  const question = questions.find(({ id }) => id === 'pensionRange');
  assert.equal(question.title, 'Você paga pensão alimentícia atualmente? Se sim, qual faixa de valor?');
  assert.deepEqual(question.options, [
    ['not_paying', 'Não pago pensão atualmente'],
    ['up_to_500', 'Até R$ 500'],
    ['from_500_to_1500', 'De R$ 500 a R$ 1.500'],
    ['above_1500', 'Acima de R$ 1.500'],
  ]);
});
