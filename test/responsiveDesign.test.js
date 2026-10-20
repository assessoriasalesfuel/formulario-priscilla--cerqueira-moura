import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const styles = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../public/js/app.js', import.meta.url), 'utf8');
const indexHtml = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

test('mantém layout mobile-first e largura mínima suportada', () => {
  assert.match(styles, /html \{[\s\S]*?min-width: 320px/u);
  assert.match(styles, /\.page-shell \{[\s\S]*?width: 100%;[\s\S]*?max-width: var\(--content-width\)/u);
  assert.match(styles, /\.choice-list \{[\s\S]*?display: grid/u);
  assert.match(styles, /font-size: 1rem/u);
  assert.match(styles, /min-height: 56px/u);
  assert.match(styles, /--background: #fafafa/u);
  assert.match(styles, /--surface: #ffffff/u);
  assert.match(styles, /--primary: #f97316/u);
  assert.match(styles, /--primary-strong: #ea580c/u);
  assert.match(styles, /--heading: #18181b/u);
  assert.match(styles, /--accent: #f97316/u);
  assert.match(styles, /color-scheme: only light/u);
  assert.match(indexHtml, /name="color-scheme" content="only light"/u);
  assert.doesNotMatch(styles, /#234b43|#173a34|#2f715b|#e56a54/ui);
  assert.doesNotMatch(indexHtml, /fonts\.googleapis|fonts\.gstatic/u);
});

test('mantém opções em uma coluna no mobile e amplia progressivamente em telas maiores', () => {
  assert.match(styles, /@media \(min-width: 720px\)/u);
  assert.match(styles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/u);
  assert.match(styles, /\.consent-list \{ grid-template-columns: 1fr; \}/u);
});

test('trata telas estreitas, paisagem, safe areas e preferências de acessibilidade', () => {
  assert.match(styles, /@media \(max-width: 380px\)/u);
  assert.match(styles, /@media \(max-height: 560px\) and \(orientation: landscape\)/u);
  assert.match(styles, /100svh/u);
  assert.match(styles, /100dvh/u);
  assert.match(styles, /safe-area-inset-bottom/u);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.match(styles, /@media \(forced-colors: active\)/u);
});

test('perguntas de escolha usam botão Continuar e não dependem de autoavanço', () => {
  assert.match(appSource, /createChoiceQuestion[\s\S]*?'Continuar'/u);
  assert.match(appSource, /input\[name="\$\{question\.id\}"\]:checked/u);
  assert.doesNotMatch(appSource, /autoAdvanceTimer|setTimeout\(async/u);
});

test('avanço e retorno preservam respostas e sempre chegam ao contato', () => {
  assert.match(appSource, /function nextStepIndex\(\) \{\s*return currentStep \+ 1;/u);
  assert.match(appSource, /input\.checked = answers\[question\.id\]/u);
  assert.match(appSource, /renderStep\(previousStepIndex\(\)\)/u);
  assert.doesNotMatch(appSource, /classifyLead|paymentMethod ===|legalSituation ===/u);
});

test('envio apresenta feedback e WhatsApp não depende da telemetria', () => {
  assert.match(appSource, /Enviando\.\.\./u);
  assert.match(appSource, /aria-busy/u);
  assert.match(appSource, /href: whatsappUrl/u);
  assert.match(appSource, /catch \(error\)[\s\S]*showError/u);
  assert.match(appSource, /finally \{[\s\S]*submitButton\.disabled = false/u);
});

test('início valida o estado real da integração antes das perguntas', () => {
  assert.match(appSource, /fetch\('\/api\/integration-status'/u);
  assert.match(appSource, /data\?\.googleSheets !== 'operational'/u);
  assert.match(appSource, /await verifyIntegration\(\)/u);
});

test('progresso não depende de estilo inline', () => {
  assert.match(appSource, /'data-progress': `\$\{position\}-\$\{questions\.length\}`/u);
  assert.doesNotMatch(appSource, /fill\.style\.width/u);
  assert.match(styles, /data-progress="4-4"[^}]*width: 100%/u);
});

test('botão Voltar possui ícone, contraste, estados e alvo de toque acessível', () => {
  assert.match(appSource, /back-button__icon[\s\S]*←/u);
  assert.match(appSource, /back-button__label[\s\S]*Voltar/u);
  assert.match(styles, /\.back-button \{[\s\S]*?min-width: 104px;[\s\S]*?min-height: 48px;[\s\S]*?border: 1px solid var\(--border-strong\)/u);
  assert.match(styles, /\.back-button:hover/u);
  assert.match(styles, /\.back-button:active/u);
  assert.match(styles, /\.back-button:disabled/u);
  assert.match(styles, /\.back-button:focus-visible/u);
});
