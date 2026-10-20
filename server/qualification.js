export const PRIORITIES = Object.freeze({ high: 'Alta', medium: 'Média', low: 'Baixa' });

const VALID = Object.freeze({
  legalSituation: new Set([
    'protective_order_received', 'protective_order_requested',
    'protective_order_possible', 'information_only',
  ]),
  hiringIntent: new Set(['asap', 'within_7_days', 'evaluating', 'not_hiring_now']),
  paymentMethod: new Set(['cash', 'installments_500', 'needs_values', 'not_available']),
});
const URGENCY = Object.freeze({
  asap: 'Alta', within_7_days: 'Média', evaluating: 'Baixa', not_hiring_now: 'Sem urgência comercial',
});

function result(status, hiringIntent, priorityCode, reason) {
  return Object.freeze({
    status,
    priorityCode,
    priority: priorityCode ? PRIORITIES[priorityCode] : '',
    urgency: status === 'Qualificado' ? URGENCY[hiringIntent] : 'Sem prioridade comercial',
    reason,
  });
}

function disqualified(hiringIntent, reason) {
  return result('Desqualificado', hiringIntent, null, reason);
}

export function classifyLead(answers = {}) {
  for (const [field, values] of Object.entries(VALID)) {
    if (!values.has(answers[field])) throw new TypeError(`${field} inválido.`);
  }
  const { legalSituation, hiringIntent, paymentMethod } = answers;
  if (legalSituation === 'information_only') {
    return disqualified(hiringIntent, 'Busca apenas informações sobre o assunto');
  }
  if (hiringIntent === 'not_hiring_now') {
    return disqualified(hiringIntent, 'Não pretende contratar atendimento particular neste momento');
  }
  if (paymentMethod === 'not_available') {
    return disqualified(hiringIntent, 'Sem disponibilidade financeira para contratação particular no momento');
  }
  if (paymentMethod === 'needs_values') {
    return result(
      'Pendente de qualificação financeira',
      hiringIntent,
      null,
      'Capacidade financeira ainda não confirmada',
    );
  }
  if (hiringIntent === 'asap') {
    return result('Qualificado', hiringIntent, 'high',
      'Contratação imediata com capacidade financeira compatível declarada');
  }
  if (hiringIntent === 'within_7_days') {
    return result('Qualificado', hiringIntent, 'medium',
      'Contratação em até 7 dias com capacidade financeira compatível declarada');
  }
  return result('Qualificado', hiringIntent, 'low',
    'Ainda avaliando a contratação, com capacidade financeira compatível declarada');
}
