const QUALIFYING_SITUATIONS = new Set([
  'protective_measure_received', 'measure_requested', 'report_or_complaint',
  'fear_of_measure', 'helping_family',
]);
const QUALIFYING_HIRING = new Set(['ready_to_hire', 'needs_pricing']);
const QUALIFYING_INCOME = new Set(['from_6000_to_10000', 'above_10000']);
const URGENT = new Set(['deadline_48h', 'deadline_7d', 'breach_accusation']);

export function calculatePriority(urgency) {
  if (URGENT.has(urgency)) return 'urgent';
  if (urgency === 'active_unknown_deadline') return 'high';
  return 'normal';
}

export function classifyLead(answers = {}) {
  const priority = calculatePriority(answers.urgency);
  let classification = 'disqualified';
  let reason = 'Perfil não compatível com o atendimento particular neste momento';

  if (answers.situation === 'other_situation') {
    reason = 'Situação informada fora do escopo desta análise inicial';
  } else if (answers.hiring === 'researching') {
    reason = 'Ainda está pesquisando opções';
  } else if (answers.hiring === 'free_only') {
    reason = 'Busca exclusivamente atendimento gratuito';
  } else if (answers.income === 'up_to_3000') {
    reason = 'Faixa de renda incompatível com o atendimento particular neste momento';
  } else if (!answers.dataConsent || !answers.contactConsent) {
    reason = 'Confirmações obrigatórias não aceitas';
  } else if (
    QUALIFYING_SITUATIONS.has(answers.situation)
    && QUALIFYING_HIRING.has(answers.hiring)
    && (
      QUALIFYING_INCOME.has(answers.income)
      || (answers.income === 'from_3000_to_6000' && answers.hiring === 'ready_to_hire' && priority === 'urgent')
    )
  ) {
    classification = 'qualified';
    reason = priority === 'urgent'
      ? 'Prazo ou situação urgente e disponibilidade para atendimento particular'
      : 'Situação compatível e disponibilidade para atendimento particular';
  }

  return { classification, priority, reason };
}
