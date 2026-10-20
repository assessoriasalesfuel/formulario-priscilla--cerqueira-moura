import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatBrazilianPhone, normalizeName, normalizePhone, validateName, validatePhone,
} from '../public/js/validation.js';

test('normaliza nome, preservando acentos e removendo espaços duplicados', () => {
  assert.equal(normalizeName('  João   da   Silva  '), 'João da Silva');
});

test('rejeita nomes inválidos', () => {
  assert.equal(validateName('12').valid, false);
  assert.equal(validateName('12345').valid, false);
  assert.equal(validateName('  ').valid, false);
});

test('aceita nome válido normalizado', () => {
  assert.deepEqual(validateName('  Ana   Lúcia '), { valid: true, value: 'Ana Lúcia', error: '' });
});

test('normaliza WhatsApp removendo pontuação', () => {
  assert.equal(normalizePhone('(27) 99873-7944'), '27998737944');
  assert.equal(formatBrazilianPhone('27998737944'), '(27) 99873-7944');
});

test('aceita WhatsApp com 10 dígitos', () => {
  assert.equal(validatePhone('(27) 3333-4444').valid, true);
});

test('aceita WhatsApp com 11 dígitos', () => {
  assert.deepEqual(validatePhone('(27) 99873-7944'), { valid: true, value: '27998737944', error: '' });
});

test('rejeita WhatsApp inválido', () => {
  assert.equal(validatePhone('27 9873').valid, false);
  assert.equal(validatePhone('279987379441').valid, false);
});
