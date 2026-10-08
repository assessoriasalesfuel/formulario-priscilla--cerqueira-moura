export const questions = [
  {
    id: 'measureTime', type: 'choice', title: 'Quando você recebeu a medida protetiva?',
    options: [
      ['less_than_1_month', 'Menos de 1 mês'],
      ['from_1_to_3_months', '1 a 3 meses'],
      ['from_3_to_6_months', '3 a 6 meses'],
      ['more_than_6_months', 'Mais de 6 meses'],
    ],
  },
  {
    id: 'investment', type: 'choice',
    title: 'Você está preparado para investir em uma defesa profissional?',
    options: [
      ['can_invest', 'Sim, consigo investir'],
      ['needs_installments', 'Preciso parcelar, mas consigo'],
      ['cannot_invest_now', 'Não consigo agora'],
    ],
  },
  {
    id: 'phone', type: 'tel', title: 'Qual é o seu WhatsApp?', label: 'WhatsApp com DDD',
    autocomplete: 'tel', inputMode: 'numeric', maxLength: 15, includesConsent: true,
  },
];
