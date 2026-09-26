export const questions = [
  {
    id: 'name', type: 'text', title: 'Como podemos chamar você?', label: 'Nome completo',
    autocomplete: 'name', inputMode: 'text', maxLength: 100,
  },
  {
    id: 'phone', type: 'tel', title: 'Qual é o seu melhor WhatsApp?', label: 'WhatsApp com DDD',
    autocomplete: 'tel', inputMode: 'numeric', maxLength: 15,
  },
  {
    id: 'email', type: 'email', title: 'Qual é o seu melhor e-mail?', label: 'E-mail',
    autocomplete: 'email', inputMode: 'email', maxLength: 254,
  },
  {
    id: 'situation', type: 'choice', title: 'Qual opção mais se aproxima da sua situação?',
    options: [
      ['protective_measure_received', 'Já recebi uma medida protetiva.'],
      ['measure_requested', 'Disseram que solicitaram uma medida contra mim.'],
      ['report_or_complaint', 'Foi registrado um boletim de ocorrência ou denúncia.'],
      ['fear_of_measure', 'Tenho receio de que uma medida seja solicitada.'],
      ['helping_family', 'Estou buscando ajuda para um familiar.'],
      ['other_situation', 'Minha situação é diferente dessas.'],
    ],
  },
  {
    id: 'income', type: 'choice',
    title: 'Para direcionarmos o atendimento adequado, qual é sua faixa de renda mensal aproximada?',
    options: [
      ['up_to_3000', 'Até R$ 3.000.'],
      ['from_3000_to_6000', 'De R$ 3.001 a R$ 6.000.'],
      ['from_6000_to_10000', 'De R$ 6.001 a R$ 10.000.'],
      ['above_10000', 'Acima de R$ 10.000.'],
    ],
  },
  {
    id: 'pensionRange', type: 'choice',
    title: 'Você paga pensão alimentícia atualmente? Se sim, qual faixa de valor?',
    options: [
      ['not_paying', 'Não pago pensão atualmente'],
      ['up_to_500', 'Até R$ 500'],
      ['from_500_to_1500', 'De R$ 500 a R$ 1.500'],
      ['above_1500', 'Acima de R$ 1.500'],
    ],
  },
  {
    id: 'urgency', type: 'choice', title: 'Existe algo que precisa ser resolvido rapidamente?',
    options: [
      ['deadline_48h', 'Tenho audiência ou prazo nas próximas 48 horas.'],
      ['deadline_7d', 'Tenho audiência ou prazo nos próximos 7 dias.'],
      ['breach_accusation', 'Existe uma acusação de descumprimento.'],
      ['active_unknown_deadline', 'A medida já está valendo, mas não sei os prazos.'],
      ['no_official_deadline', 'Ainda não existe prazo ou medida oficial.'],
      ['unknown', 'Não sei informar.'],
    ],
  },
  {
    id: 'hiring', type: 'choice',
    title: 'Caso seja identificada uma estratégia adequada para o seu caso, qual opção representa melhor seu momento?',
    options: [
      ['ready_to_hire', 'Estou preparado para contratar e quero resolver isso agora.'],
      ['needs_pricing', 'Tenho interesse, mas preciso entender os valores e as condições.'],
      ['researching', 'Ainda estou apenas pesquisando.'],
      ['free_only', 'Procuro exclusivamente atendimento gratuito.'],
    ],
  },
  { id: 'consent', type: 'consent', title: 'Podemos analisar suas respostas e entrar em contato?' },
];
