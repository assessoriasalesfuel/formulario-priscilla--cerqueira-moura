import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pixelSource = await readFile(new URL('../public/js/metaPixel.js', import.meta.url), 'utf8');
const trackingSource = await readFile(new URL('../public/js/tracking.js', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../public/js/app.js', import.meta.url), 'utf8');
const indexHtml = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const serverSource = await readFile(new URL('../server.js', import.meta.url), 'utf8');

test('configura o Meta Pixel aprovado e registra somente PageView', () => {
  assert.match(pixelSource, /META_PIXEL_ID = '959018970525443'/u);
  assert.match(pixelSource, /connect\.facebook\.net\/en_US\/fbevents\.js/u);
  assert.match(pixelSource, /fbq\('init', META_PIXEL_ID\)/u);
  assert.match(pixelSource, /fbq\('track', 'PageView'\)/u);
  assert.equal((pixelSource.match(/fbq\('track'/gu) ?? []).length, 1);
});

test('mantém fallback sem JavaScript e libera somente os domínios necessários na CSP', () => {
  assert.match(indexHtml, /src="\/js\/metaPixel\.js" defer/u);
  assert.match(indexHtml, /facebook\.com\/tr\?id=959018970525443&amp;ev=PageView&amp;noscript=1/u);
  assert.match(serverSource, /script-src 'self' https:\/\/connect\.facebook\.net/u);
  assert.match(serverSource, /img-src 'self' data: https:\/\/www\.facebook\.com/u);
  assert.doesNotMatch(serverSource, /unsafe-inline/u);
});

test('mede o funil, lead qualificado e clique no WhatsApp sem enviar respostas ou dados pessoais', () => {
  assert.match(appSource, /trackCustomEvent\('FormStarted'/u);
  assert.match(appSource, /trackCustomEvent\('FormStepCompleted'/u);
  assert.match(appSource, /trackCustomEvent\('FormSubmitted'/u);
  assert.match(appSource, /if \(eligible\) trackStandardEvent\('Lead'/u);
  assert.match(appSource, /trackStandardEvent\('Contact', \{ contact_method: 'whatsapp' \}/u);
  assert.match(trackingSource, /trackedOnce\.has\(uniqueKey\)/u);
  assert.doesNotMatch(appSource, /track(?:Custom|Standard)Event\([^\n]*answers/u);
  assert.doesNotMatch(appSource, /track(?:Custom|Standard)Event\([^\n]*(?:name|phone)/u);
});
