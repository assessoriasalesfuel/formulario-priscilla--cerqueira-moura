import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const indexHtml = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const appSource = await readFile(new URL('../public/js/app.js', import.meta.url), 'utf8');

function count(source, value) {
  return source.split(value).length - 1;
}

test('código base inicializa o Pixel e dispara PageView uma única vez', () => {
  assert.equal(count(indexHtml, "fbq('init', '959018970525443')"), 1);
  assert.equal(count(indexHtml, "fbq('track', 'PageView')"), 1);
  assert.equal(count(indexHtml, 'connect.facebook.net/en_US/fbevents.js'), 1);
  assert.equal(count(indexHtml, 'noscript=1'), 1);
});

test('eventos de conclusão dependem do sucesso e da classificação do backend', () => {
  const completion = appSource.indexOf('const completion = await completeLead(leadId, answers)');
  const completedEvent = appSource.indexOf('trackFormCompleted()', completion);
  const leadEvent = appSource.indexOf('trackQualifiedLead(completion.qualified)', completion);
  const resultRender = appSource.indexOf('renderResult(completion)', completion);
  assert.ok(completion >= 0 && completion < completedEvent);
  assert.ok(completedEvent < leadEvent);
  assert.ok(leadEvent < resultRender);
});

test('Contact depende do sucesso do endpoint e ocorre antes da abertura do WhatsApp', () => {
  const endpoint = appSource.indexOf('await registerWhatsAppAccess(leadId)');
  const contactEvent = appSource.indexOf('trackWhatsAppContact()', endpoint);
  const whatsappOpen = appSource.indexOf('window.open(whatsappLink', endpoint);
  assert.ok(endpoint >= 0 && endpoint < contactEvent);
  assert.ok(contactEvent < whatsappOpen);
});
