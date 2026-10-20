export const questions = Object.freeze([
  {
    id: 'legalSituation', type: 'choice',
    title: 'Qual é a sua situação atual?',
    options: [
      ['protective_order_received', 'Já recebi uma medida protetiva contra mim.'],
      ['protective_order_requested', 'Existe um pedido de medida protetiva contra mim.'],
      ['protective_order_possible', 'Acredito que posso receber uma medida protetiva.'],
      ['information_only', 'Quero apenas informações sobre o assunto.'],
    ],
    note: 'Não inclua relatos, nomes de terceiros, documentos ou informações íntimas neste formulário.',
  },
  {
    id: 'primaryConcern', type: 'choice',
    title: 'O que mais preocupa você nessa situação?',
    options: [
      ['restrictions_and_consequences', 'As restrições e consequências da medida protetiva.'],
      ['how_to_act_and_rights', 'Não saber como agir ou quais são meus direitos.'],
      ['situation_getting_worse', 'A possibilidade de a situação se agravar.'],
      ['understand_how_it_works', 'Quero entender melhor como funciona.'],
    ],
  },
  {
    id: 'hiringIntent', type: 'choice',
    title: 'Quando pretende buscar assistência jurídica?',
    options: [
      ['asap', 'Quero contratar uma advogada o quanto antes.'],
      ['within_7_days', 'Pretendo contratar nos próximos 7 dias.'],
      ['evaluating', 'Ainda estou avaliando a contratação.'],
      ['not_hiring_now', 'Não pretendo contratar neste momento.'],
    ],
  },
  {
    id: 'paymentMethod', type: 'choice',
    title: 'Qual condição de pagamento seria viável para você?',
    options: [
      ['cash', 'Tenho disponibilidade para pagar à vista, conforme os honorários apresentados.'],
      ['installments_500', 'Consigo assumir parcelas a partir de R$ 500 mensais.'],
      ['needs_values', 'Preciso conhecer os valores antes de confirmar.'],
      ['not_available', 'Não tenho disponibilidade financeira atualmente.'],
    ],
  },
  { id: 'contact', type: 'contact', title: 'Contato' },
]);

export const choiceCodes = Object.freeze(Object.fromEntries(
  questions.filter(({ type }) => type === 'choice')
    .map(({ id, options }) => [id, Object.freeze(options.map(([code]) => code))]),
));
