import { randomUUID } from 'node:crypto';
import { classifyLead } from '../public/js/qualification.js';
import { questions } from '../public/js/questions.js';
import { validateEmail, validateName, validatePhone } from '../public/js/validation.js';
import { createWhatsAppLink } from '../public/js/whatsapp.js';
import {
  assertCanonicalLeadRow,
  COLUMN_COUNT,
  LEAD_COLUMNS as COLUMNS,
  normalizeLeadRow,
} from './leadSchema.js';

export { COLUMN_COUNT };

const ATTRIBUTION_LIMITS = Object.freeze({
  utmSource: 255,
  utmMedium: 255,
  utmCampaign: 255,
  utmContent: 255,
  utmTerm: 255,
  fbclid: 512,
  entryUrl: 2000,
});
const DEVICES = new Set(['Mobile', 'Tablet', 'Desktop']);
const CREATE_FIELDS = new Set(['name', 'phone', 'email', ...Object.keys(ATTRIBUTION_LIMITS), 'device']);

const OPTION_LABELS = new Map(
  questions.flatMap(({ id, options = [] }) => options.map(([value, label]) => [`${id}:${value}`, label])),
);
const CHOICE_IDS = new Map(
  questions.filter(({ type }) => type === 'choice').map(({ id, options }) => [id, new Set(options.map(([value]) => value))]),
);

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

function ensureObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LeadServiceError('Payload inválido.');
  }
  return value;
}

function validatePersonal(payload) {
  const name = validateName(payload.name);
  const phone = validatePhone(payload.phone);
  const email = validateEmail(payload.email);
  const failure = [name, phone, email].find(({ valid }) => !valid);
  if (failure) throw new LeadServiceError(failure.error);
  return { name: name.value, phone: phone.value, email: email.value };
}

function validateChoice(id, value) {
  if (!CHOICE_IDS.get(id)?.has(value)) throw new LeadServiceError(`Resposta inválida para ${id}.`);
  return value;
}

function applyPersonal(row, personal) {
  row[COLUMNS.name] = protectSheetText(personal.name);
  row[COLUMNS.phone] = personal.phone;
  row[COLUMNS.email] = protectSheetText(personal.email);
}

export function normalizeAttribution(payload = {}) {
  const normalized = {};
  Object.entries(ATTRIBUTION_LIMITS).forEach(([key, limit]) => {
    normalized[key] = typeof payload[key] === 'string'
      ? Array.from(payload[key]).slice(0, limit).join('')
      : '';
  });
  normalized.device = DEVICES.has(payload.device) ? payload.device : '';
  return normalized;
}

function applyAttribution(row, attribution) {
  Object.keys(ATTRIBUTION_LIMITS).forEach((key) => {
    row[COLUMNS[key]] = protectSheetText(attribution[key]);
  });
  row[COLUMNS.device] = attribution.device;
}

function toSheetLabel(id, value) {
  return protectSheetText(OPTION_LABELS.get(`${id}:${value}`));
}

export function createLeadService({ repository, now = () => new Date(), createId = randomUUID } = {}) {
  if (!repository) throw new TypeError('O repositório de leads é obrigatório.');
  const creationRequests = new Map();

  async function findLead(leadId) {
    if (typeof leadId !== 'string' || !leadId.trim()) throw new LeadServiceError('Lead ID inválido.');
    const match = await repository.findByLeadId(leadId);
    if (!match) throw new LeadServiceError('Lead não encontrado.', 404, 'LEAD_NOT_FOUND');
    return { rowNumber: match.rowNumber, row: normalizeLeadRow(match.row) };
  }

  async function create(payload) {
    ensureObject(payload);
    if (Object.keys(payload).some((key) => !CREATE_FIELDS.has(key))) {
      throw new LeadServiceError('Payload de criação inválido.');
    }
    const personal = validatePersonal(payload);
    const attribution = normalizeAttribution(payload);
    const timestamp = now().toISOString();
    const leadId = createId();
    const row = normalizeLeadRow();
    row[COLUMNS.leadId] = leadId;
    row[COLUMNS.createdAt] = timestamp;
    row[COLUMNS.status] = 'Em preenchimento';
    applyPersonal(row, personal);
    applyAttribution(row, attribution);
    await repository.append(assertCanonicalLeadRow(row));
    return { leadId, status: 'Em preenchimento' };
  }

  return {
    async createLead(payload, idempotencyKey) {
      if (!idempotencyKey) return create(payload);
      if (typeof idempotencyKey !== 'string' || idempotencyKey.length > 100) {
        throw new LeadServiceError('Chave de idempotência inválida.');
      }
      if (creationRequests.has(idempotencyKey)) return creationRequests.get(idempotencyKey);
      const request = create(payload).catch((error) => {
        creationRequests.delete(idempotencyKey);
        throw error;
      });
      creationRequests.set(idempotencyKey, request);
      return request;
    },

    async updateLead(leadId, payload) {
      ensureObject(payload);
      const allowed = new Set(['situation', 'income', 'pensionRange', 'urgency', 'hiring', 'name', 'phone', 'email']);
      const keys = Object.keys(payload);
      if (!keys.length || keys.some((key) => !allowed.has(key))) {
        throw new LeadServiceError('Payload de atualização inválido.');
      }

      const { rowNumber, row } = await findLead(leadId);
      if (payload.name !== undefined || payload.phone !== undefined || payload.email !== undefined) {
        const personal = validatePersonal({
          name: payload.name ?? row[COLUMNS.name].replace(/^'/u, ''),
          phone: payload.phone ?? row[COLUMNS.phone],
          email: payload.email ?? row[COLUMNS.email].replace(/^'/u, ''),
        });
        applyPersonal(row, personal);
      }
      for (const id of ['situation', 'income', 'pensionRange', 'urgency', 'hiring']) {
        if (payload[id] !== undefined) row[COLUMNS[id]] = toSheetLabel(id, validateChoice(id, payload[id]));
      }
      await repository.update(rowNumber, assertCanonicalLeadRow(row));
      return { leadId, status: row[COLUMNS.status] };
    },

    async completeLead(leadId, payload) {
      ensureObject(payload);
      const personal = validatePersonal(payload);
      const normalized = {
        ...personal,
        situation: validateChoice('situation', payload.situation),
        income: validateChoice('income', payload.income),
        pensionRange: validateChoice('pensionRange', payload.pensionRange),
        urgency: validateChoice('urgency', payload.urgency),
        hiring: validateChoice('hiring', payload.hiring),
        dataConsent: payload.dataConsent === true,
        contactConsent: payload.contactConsent === true,
      };
      if (!normalized.dataConsent || !normalized.contactConsent) {
        throw new LeadServiceError('As duas confirmações são obrigatórias.');
      }

      const { rowNumber, row } = await findLead(leadId);
      const result = classifyLead(normalized);
      applyPersonal(row, personal);
      for (const id of ['situation', 'income', 'pensionRange', 'urgency', 'hiring']) {
        row[COLUMNS[id]] = toSheetLabel(id, normalized[id]);
      }
      row[COLUMNS.status] = result.classification === 'qualified' ? 'Qualificado' : 'Desqualificado';
      row[COLUMNS.reason] = protectSheetText(result.reason);
      row[COLUMNS.completedAt] ||= now().toISOString();
      row[COLUMNS.dataConsent] = 'Sim';
      row[COLUMNS.contactConsent] = 'Sim';
      await repository.update(rowNumber, assertCanonicalLeadRow(row));

      return {
        classification: result.classification,
        qualified: result.classification === 'qualified',
        leadId,
      };
    },

    async registerWhatsAppAccess(leadId) {
      const { row } = await findLead(leadId);
      if (row[COLUMNS.status] !== 'Qualificado') {
        throw new LeadServiceError('WhatsApp indisponível para este lead.', 403, 'WHATSAPP_NOT_ALLOWED');
      }
      return { link: createWhatsAppLink() };
    },
  };
}
