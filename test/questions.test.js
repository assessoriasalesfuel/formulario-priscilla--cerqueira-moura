import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { questions } from '../public/js/questions.js';

test('formulário Mini possui exatamente três perguntas na ordem aprovada', () => {
  assert.deepEqual(questions.map(({ id }) => id), ['measureTime', 'investment', 'phone']);
});

test('pergunta de tempo possui texto e quatro opções exatos', () => {
  assert.deepEqual(questions[0], {
    id: 'measureTime', type: 'choice', title: 'Quando você recebeu a medida protetiva?',
    options: [
      ['less_than_1_month', 'Menos de 1 mês'],
      ['from_1_to_3_months', '1 a 3 meses'],
      ['from_3_to_6_months', '3 a 6 meses'],
      ['more_than_6_months', 'Mais de 6 meses'],
    ],
  });
});

test('pergunta de investimento possui as três opções aprovadas', () => {
  assert.deepEqual(questions[1].options, [
    ['can_invest', 'Sim, consigo investir'],
    ['needs_installments', 'Preciso parcelar, mas consigo'],
    ['cannot_invest_now', 'Não consigo agora'],
  ]);
});

test('WhatsApp é a terceira pergunta e incorpora os consentimentos', () => {
  assert.equal(questions[2].type, 'tel');
  assert.equal(questions[2].includesConsent, true);
});

test('apresentação informa duração de aproximadamente 30 segundos', async () => {
  const source = await readFile(new URL('../public/js/app.js', import.meta.url), 'utf8');
  assert.match(source, /Leva aproximadamente 30 segundos\./u);
  assert.match(source, /tratamento dos meus dados/u);
  assert.match(source, /contato comercial por WhatsApp, telefone e e-mail/u);
});
