const QUALIFYING_INVESTMENT = new Set(['can_invest', 'needs_installments']);

export function classifyLead(answers = {}) {
  let classification = 'disqualified';
  let reason = 'Perfil não compatível com o atendimento particular neste momento';

  if (answers.investment === 'cannot_invest_now') {
    reason = 'Sem disponibilidade para investimento em defesa profissional neste momento';
  } else if (QUALIFYING_INVESTMENT.has(answers.investment)) {
    classification = 'qualified';
    reason = 'Disponibilidade para investimento em defesa profissional';
  }

  return { classification, reason };
}
