export function normalizeName(value = '') {
  return String(value).trim().replace(/\s+/gu, ' ');
}

export function validateName(value) {
  const normalized = normalizeName(value);
  if (!normalized) return { valid: false, value: normalized, error: 'Informe seu nome completo.' };
  if (normalized.length < 3) return { valid: false, value: normalized, error: 'O nome deve ter pelo menos 3 caracteres.' };
  if (normalized.length > 100) return { valid: false, value: normalized, error: 'O nome deve ter no máximo 100 caracteres.' };
  if (/^\d+$/u.test(normalized)) return { valid: false, value: normalized, error: 'Informe um nome válido.' };
  return { valid: true, value: normalized, error: '' };
}

export function normalizePhone(value = '') {
  return String(value).replace(/\D/g, '');
}

export function formatBrazilianPhone(value = '') {
  const digits = normalizePhone(value).slice(0, 11);
  if (!digits) return '';
  if (digits.length <= 2) return `(${digits}`;
  const prefix = digits.slice(0, 2);
  const isMobile = digits.length > 10;
  const firstPartLength = isMobile ? 5 : 4;
  const firstPart = digits.slice(2, 2 + firstPartLength);
  const lastPart = digits.slice(2 + firstPartLength);
  return `(${prefix}) ${firstPart}${lastPart ? `-${lastPart}` : ''}`;
}

export function validatePhone(value) {
  const normalized = normalizePhone(value);
  const valid = normalized.length === 10 || normalized.length === 11;
  return {
    valid,
    value: normalized,
    error: valid ? '' : 'Informe um WhatsApp com DDD e 10 ou 11 dígitos.',
  };
}
