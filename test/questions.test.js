import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { questions, choiceCodes } from '../public/js/questions.js';

test('formulário possui as cinco etapas novas na ordem definida', () => {
  assert.deepEqual(questions.map(({ id }) => id), [
    'legalSituation', 'primaryConcern', 'hiringIntent', 'paymentMethod', 'contact',
  ]);
  assert.ok(questions.slice(0, 4).every(({ options }) => options.length === 4));
  assert.equal(questions[4].type, 'contact');
});

test('alternativas usam códigos internos estáveis', () => {
  assert.deepEqual(choiceCodes.legalSituation, [
    'protective_order_received', 'protective_order_requested',
    'protective_order_possible', 'information_only',
  ]);
  assert.deepEqual(choiceCodes.primaryConcern, [
    'restrictions_and_consequences', 'how_to_act_and_rights',
    'situation_getting_worse', 'understand_how_it_works',
  ]);
  assert.deepEqual(choiceCodes.hiringIntent, ['asap', 'within_7_days', 'evaluating', 'not_hiring_now']);
  assert.deepEqual(choiceCodes.paymentMethod, ['cash', 'installments_500', 'needs_values', 'not_available']);
});

test('perguntas e alternativas correspondem ao texto comercial aprovado', () => {
  assert.equal(questions[0].title, 'Qual é a sua situação atual?');
  assert.equal(questions[1].title, 'O que mais preocupa você nessa situação?');
  assert.equal(questions[2].title, 'Quando pretende buscar assistência jurídica?');
  assert.equal(questions[3].title, 'Qual condição de pagamento seria viável para você?');
  assert.match(questions[3].options[1][1], /R\$ 500 mensais/u);
  assert.equal(questions[3].options[2][1], 'Preciso conhecer os valores antes de confirmar.');
});

test('abertura usa a identidade minimalista solicitada e mantém aviso jurídico', async () => {
  const source = await readFile(new URL('../public/js/app.js', import.meta.url), 'utf8');
  assert.match(source, /MEDIDA PROTETIVA/u);
  assert.match(source, /Recebeu uma ou acredita que pode receber\?/u);
  assert.match(source, /Responda algumas perguntas para verificar a possibilidade de atendimento jurídico particular\./u);
  assert.match(source, /Este formulário não oferece consulta jurídica gratuita/u);
  assert.match(source, /createButton\('Começar'\)/u);
});

test('contato reúne nome, WhatsApp e consentimentos sem marketing', async () => {
  const source = await readFile(new URL('../public/js/app.js', import.meta.url), 'utf8');
  assert.match(source, /id: 'name'/u);
  assert.match(source, /id: 'phone'/u);
  assert.match(source, /id: 'privacyAcknowledged'/u);
  assert.match(source, /id: 'contactConsent'/u);
  assert.doesNotMatch(source, /marketingConsent|rastreamento de marketing/ui);
});

test('WhatsApp aparece somente quando o backend confirma elegibilidade', async () => {
  const source = await readFile(new URL('../public/js/app.js', import.meta.url), 'utf8');
  assert.match(source, /result\.whatsappEligible === true/u);
  assert.match(source, /candidate\.protocol === 'https:' && candidate\.hostname === 'wa\.me'/u);
  assert.match(source, /result\.completionAction === 'whatsapp'/u);
  assert.match(source, /if \(eligible\)[\s\S]*Continuar pelo WhatsApp/u);
  assert.match(source, /result\.completionAction === 'financial_review'/u);
  assert.match(source, /A possibilidade de contratação depende da confirmação/u);
  assert.match(source, /não será possível dar continuidade à solicitação por este canal/u);
});
