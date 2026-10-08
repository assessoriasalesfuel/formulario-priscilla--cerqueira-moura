import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

test('mantém layout mobile-first e largura mínima suportada', () => {
  assert.match(styles, /html \{ min-width: 320px/u);
  assert.match(styles, /\.choice-list \{ display: grid/u);
});

test('mantém opções responsivas em duas colunas a partir de 640px', () => {
  assert.match(styles, /@media \(min-width: 640px\)/u);
  assert.match(styles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/u);
  assert.match(styles, /\.consent-list \{ grid-template-columns: 1fr; \}/u);
});

test('mantém ajuste para telas estreitas e redução de movimento', () => {
  assert.match(styles, /@media \(max-width: 380px\)/u);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/u);
});
