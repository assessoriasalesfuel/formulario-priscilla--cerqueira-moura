import { questions, choiceCodes } from '../public/js/questions.js';
import { FORM_CONFIG } from '../public/js/formConfig.js';
import { validateName, validatePhone } from '../public/js/validation.js';
import { classifyLead } from './qualification.js';

const SUBMISSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const TOP_LEVEL_FIELDS = new Set(['submissionId', 'answers', 'attribution', 'privacyNoticeVersion']);
const ANSWER_FIELDS = new Set([
  'legalSituation', 'primaryConcern', 'hiringIntent', 'paymentMethod',
  'name', 'phone', 'privacyAcknowledged', 'contactConsent',
]);
const ATTRIBUTION_LIMITS = Object.freeze({
  utmSource: 255, utmMedium: 255, utmCampaign: 255, utmContent: 255,
  utmTerm: 255, fbclid: 512, entryUrl: 2000,
});
const DEVICES = new Set(['Mobile', 'Tablet', 'Desktop']);
const CHOICE_LABELS = new Map(questions.flatMap(({ id, options = [] }) => (
  options.map(([code, label]) => [`${id}:${code}`, label])
)));
const CHOICE_SETS = new Map(Object.entries(choiceCodes).map(([id, codes]) => [id, new Set(codes)]));
const FINANCIAL_LABELS = Object.freeze({
  cash: 'Capacidade financeira compatível declarada — pagamento à vista',
  installments_500: 'Capacidade financeira compatível declarada — parcelas a partir de R$ 500 mensais',
  needs_values: 'Capacidade financeira ainda não confirmada',
  not_available: 'Sem disponibilidade financeira atualmente',
});
const WHATSAPP_URL = `https://wa.me/5527998737944?text=${encodeURIComponent(
  'Olá, Dra. Priscilla. Preenchi o formulário e gostaria de dar continuidade à solicitação de atendimento jurídico particular.',
)}`;

export class LeadServiceError extends Error {
  constructor(message, statusCode = 400, code = 'INVALID_REQUEST') {
    super(message);
    this.name = 'LeadServiceError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function protectSheetText(value) {
  const text = String(value ?? '');
  return /^[=+\-@]/u.test(text) ? `'${text}` : text;
}

function ensureObject(value, message = 'Payload inválido.') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LeadServiceError(message);
  return value;
}

function ensureExactKeys(value, allowed, message) {
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new LeadServiceError(message);
}

function validateChoice(id, value) {
  if (!CHOICE_SETS.get(id)?.has(value)) throw new LeadServiceError(`Resposta inválida para ${id}.`);
  return value;
}

function normalizeAttribution(value) {
  const payload = ensureObject(value ?? {}, 'Atribuição inválida.');
  const normalized = {};
  for (const [key, limit] of Object.entries(ATTRIBUTION_LIMITS)) {
    normalized[key] = protectSheetText(
      typeof payload[key] === 'string' ? Array.from(payload[key]).slice(0, limit).join('') : '',
    );
  }
  normalized.device = DEVICES.has(payload.device) ? payload.device : '';
  return normalized;
}

function validateSubmission(payload, idempotencyKey) {
  ensureObject(payload);
  ensureExactKeys(payload, TOP_LEVEL_FIELDS, 'Payload de submissão inválido.');
  if (typeof payload.submissionId !== 'string' || !SUBMISSION_ID_PATTERN.test(payload.submissionId)) {
    throw new LeadServiceError('Submission ID inválido.');
  }
  const submissionId = payload.submissionId.toLowerCase();
  if (idempotencyKey !== submissionId) {
    throw new LeadServiceError('A chave de idempotência deve corresponder ao Submission ID.');
  }
  if (payload.privacyNoticeVersion !== FORM_CONFIG.privacyNoticeVersion) {
    throw new LeadServiceError('Versão do aviso de privacidade inválida.');
  }

  const answers = ensureObject(payload.answers, 'Respostas inválidas.');
  ensureExactKeys(answers, ANSWER_FIELDS, 'Campos de resposta inválidos.');
  const name = validateName(answers.name);
  const phone = validatePhone(answers.phone);
  if (!name.valid) throw new LeadServiceError(name.error);
  if (!phone.valid) throw new LeadServiceError(phone.error);
  if (answers.privacyAcknowledged !== true) throw new LeadServiceError('Confirme a ciência do aviso de privacidade.');
  if (answers.contactConsent !== true) throw new LeadServiceError('Autorize o contato para concluir o formulário.');

  return {
    submissionId,
    answers: {
      legalSituation: validateChoice('legalSituation', answers.legalSituation),
      primaryConcern: validateChoice('primaryConcern', answers.primaryConcern),
      hiringIntent: validateChoice('hiringIntent', answers.hiringIntent),
      paymentMethod: validateChoice('paymentMethod', answers.paymentMethod),
      name: name.value,
      phone: phone.value,
    },
    attribution: normalizeAttribution(payload.attribution),
    privacyNoticeVersion: payload.privacyNoticeVersion,
  };
}

function responseFromRecord(record) {
  const whatsappEligible = record.status === 'Qualificado';
  const completionAction = whatsappEligible
    ? 'whatsapp'
    : record.status === 'Pendente de qualificação financeira' ? 'financial_review' : 'none';
  return {
    leadId: record.leadId,
    submissionId: record.submissionId,
    completionAction,
    whatsappEligible,
    whatsappUrl: whatsappEligible ? WHATSAPP_URL : null,
  };
}

export function createLeadService({ repository, now = () => new Date() } = {}) {
  if (!repository) throw new TypeError('O repositório de leads é obrigatório.');
  const activeSubmissions = new Map();

  async function persist(validated) {
    const existing = await repository.findBySubmissionId(validated.submissionId);
    if (existing) return responseFromRecord(existing.record);

    const classification = classifyLead(validated.answers);
    const record = {
        leadId: validated.submissionId,
        submissionId: validated.submissionId,
        createdAt: now(),
        name: protectSheetText(validated.answers.name),
        phone: validated.answers.phone,
        status: classification.status,
        priority: classification.priority,
        operationalUrgency: classification.urgency,
        legalSituation: protectSheetText(
          `${CHOICE_LABELS.get(`legalSituation:${validated.answers.legalSituation}`)} `
          + `| Preocupação principal: ${CHOICE_LABELS.get(`primaryConcern:${validated.answers.primaryConcern}`)}`,
        ),
        hiringIntent: protectSheetText(CHOICE_LABELS.get(`hiringIntent:${validated.answers.hiringIntent}`)),
        caseAwarenessTime: '',
        lawyerSituation: '',
        financialAvailability: protectSheetText(
          `${FINANCIAL_LABELS[validated.answers.paymentMethod]} `
          + `| Condição declarada: ${CHOICE_LABELS.get(`paymentMethod:${validated.answers.paymentMethod}`)}`,
        ),
        classificationReason: protectSheetText(classification.reason),
        contactConsent: 'Sim',
        privacyAcknowledged: 'Sim',
        privacyNoticeVersion: protectSheetText(validated.privacyNoticeVersion),
        ...validated.attribution,
    };

    try {
      await repository.append(record);
    } catch (error) {
      const recovered = await repository.findBySubmissionId(validated.submissionId).catch(() => null);
      if (recovered) return responseFromRecord(recovered.record);
      throw error;
    }
    return responseFromRecord(record);
  }

  return Object.freeze({
    async submitLead(payload, idempotencyKey) {
      const validated = validateSubmission(payload, idempotencyKey);
      if (activeSubmissions.has(validated.submissionId)) return activeSubmissions.get(validated.submissionId);
      const request = persist(validated).finally(() => activeSubmissions.delete(validated.submissionId));
      activeSubmissions.set(validated.submissionId, request);
      return request;
    },
  });
}
