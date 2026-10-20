import { questions } from './questions.js';
import { FORM_CONFIG } from './formConfig.js';
import { formatBrazilianPhone, validateName, validatePhone } from './validation.js';
import { captureAttribution } from './attribution.js';

async function submitLead(payload, idempotencyKey) {
  let response;
  try {
    response = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('Não foi possível conectar ao servidor. Tente novamente.');
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('O servidor retornou uma resposta inválida.');
  }
  if (!response.ok) {
    throw new Error(data?.error?.message || 'Não foi possível salvar suas respostas.');
  }
  return data;
}

async function verifyIntegration() {
  let response;
  try {
    response = await fetch('/api/integration-status', { headers: { Accept: 'application/json' }, cache: 'no-store' });
  } catch {
    throw new Error('Não foi possível verificar a integração. Tente novamente.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.googleSheets !== 'operational') {
    throw new Error(data?.error?.message || 'A integração com Google Sheets está indisponível.');
  }
}

const app = document.querySelector('#app');
const attribution = captureAttribution();
let answers = {
  legalSituation: '', primaryConcern: '', hiringIntent: '', paymentMethod: '',
  name: '', phone: '', privacyAcknowledged: false, contactConsent: false,
};
let currentStep = -1;
let submitting = false;
const submissionId = crypto.randomUUID();

function element(tag, attributes = {}, text = '') {
  const node = document.createElement(tag);
  Object.entries(attributes).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    if (key === 'className') node.className = value;
    else if (key === 'disabled') node.disabled = value;
    else node.setAttribute(key, value);
  });
  if (text) node.textContent = text;
  return node;
}

function clearApp() {
  app.replaceChildren();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function focusPrimary() {
  requestAnimationFrame(() => app.querySelector('[data-autofocus], h1')?.focus({ preventScroll: true }));
}

function createButton(label, className = 'button button--primary') {
  return element('button', { type: 'button', className }, label);
}

function createError(id) {
  return element('p', { id, className: 'field-error', role: 'alert', hidden: '' });
}

function showError(control, errorNode, message) {
  errorNode.textContent = message;
  errorNode.hidden = false;
  control?.setAttribute('aria-invalid', 'true');
  control?.focus();
}

function clearError(control, errorNode) {
  errorNode.hidden = true;
  errorNode.textContent = '';
  control?.removeAttribute('aria-invalid');
}

function nextStepIndex() {
  return currentStep + 1;
}

function previousStepIndex() {
  return currentStep - 1;
}

function renderIntro() {
  currentStep = -1;
  clearApp();
  const card = element('section', { className: 'card card--intro', 'aria-labelledby': 'intro-title' });
  const title = element('h1', { id: 'intro-title', tabindex: '-1' });
  title.textContent = 'MEDIDA PROTETIVA';
  const button = createButton('Começar');
  const integrationError = createError('integration-error');
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Verificando...';
    clearError(null, integrationError);
    try {
      await verifyIntegration();
      renderStep(0);
    } catch (error) {
      showError(null, integrationError, error?.message || 'A integração está indisponível. Tente novamente.');
      button.disabled = false;
      button.textContent = 'Começar';
    }
  });
  card.append(
    title,
    element('p', { className: 'support-line' }, 'Recebeu uma ou acredita que pode receber?'),
    element('p', { className: 'lead' }, 'Responda algumas perguntas para verificar a possibilidade de atendimento jurídico particular.'),
    element('p', { className: 'service-notice' }, 'Atendimento particular, sujeito à cobrança de honorários advocatícios. Este formulário não oferece consulta jurídica gratuita.'),
    button,
    integrationError,
  );
  app.append(card);
  focusPrimary();
}

function createProgress() {
  const position = currentStep + 1;
  const wrapper = element('div', { className: 'progress' });
  const track = element('div', {
    className: 'progress__track', role: 'progressbar', 'aria-valuemin': '1',
    'aria-valuemax': String(questions.length), 'aria-valuenow': String(position),
    'aria-label': 'Progresso do formulário',
  });
  const fill = element('span', {
    className: 'progress__fill', 'data-progress': `${position}-${questions.length}`,
  });
  track.append(fill);
  wrapper.append(
    element('p', { className: 'progress__label', 'aria-live': 'polite' }, `Etapa ${position} de ${questions.length}`),
    track,
  );
  return wrapper;
}

function goForward() {
  renderStep(nextStepIndex());
}

function createChoiceQuestion(question, form) {
  const fieldset = element('fieldset', {
    className: 'choice-list', 'aria-describedby': `${question.id}-hint ${question.id}-error`,
  });
  fieldset.append(
    element('legend', { className: 'sr-only' }, question.title),
    element('p', { id: `${question.id}-hint`, className: 'selection-hint' }, 'Selecione uma opção para continuar.'),
  );
  const error = createError(`${question.id}-error`);
  question.options.forEach(([value, labelText], index) => {
    const label = element('label', { className: 'choice' });
    const input = element('input', {
      type: 'radio', name: question.id, value, ...(index === 0 ? { 'data-autofocus': '' } : {}),
    });
    input.checked = answers[question.id] === value;
    input.addEventListener('change', () => {
      answers[question.id] = value;
      fieldset.querySelectorAll('input').forEach((control) => control.removeAttribute('aria-invalid'));
      clearError(null, error);
    });
    label.append(input, element('span', { className: 'choice__marker', 'aria-hidden': 'true' }),
      element('span', { className: 'choice__text' }, labelText));
    fieldset.append(label);
  });
  if (question.note) fieldset.append(element('p', { className: 'field-note' }, question.note));
  const continueButton = element('button', { type: 'submit', className: 'button button--primary' }, 'Continuar');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const selected = form.querySelector(`input[name="${question.id}"]:checked`);
    if (!selected) {
      showError(form.querySelector(`input[name="${question.id}"]`), error, 'Selecione uma opção para continuar.');
      return;
    }
    continueButton.disabled = true;
    goForward();
  });
  form.append(fieldset, error, continueButton);
}

function appendConsent(fieldset, { id, text }) {
  const label = element('label', { className: 'choice choice--checkbox' });
  const input = element('input', { type: 'checkbox', id, name: id, required: '' });
  input.checked = answers[id];
  input.addEventListener('change', () => { answers[id] = input.checked; });
  label.append(input, element('span', { className: 'choice__marker', 'aria-hidden': 'true' }),
    element('span', { className: 'choice__text' }, text));
  fieldset.append(label);
  return input;
}

function contactField({ id, label, type, autocomplete, inputmode, maxlength }, autofocus = false) {
  const group = element('div', { className: 'field-group' });
  const input = element('input', {
    id, name: id, type, autocomplete, inputmode, maxlength, required: '',
    'aria-describedby': `${id}-error`, ...(autofocus ? { 'data-autofocus': '' } : {}),
  });
  input.value = type === 'tel' ? formatBrazilianPhone(answers[id]) : answers[id];
  const error = createError(`${id}-error`);
  input.addEventListener('input', () => {
    if (type === 'tel') input.value = formatBrazilianPhone(input.value);
    answers[id] = input.value;
    clearError(input, error);
  });
  group.append(element('label', { for: id }, label), input, error);
  return { group, input, error };
}

function createContactQuestion(form) {
  const name = contactField({ id: 'name', label: 'Nome completo', type: 'text', autocomplete: 'name', maxlength: '100' }, true);
  const phone = contactField({ id: 'phone', label: 'WhatsApp com DDD', type: 'tel', autocomplete: 'tel', inputmode: 'numeric', maxlength: '15' });
  const privacy = element('div', { className: 'privacy-copy' });
  privacy.append(
    element('p', {}, 'Usaremos seus dados para registrar a solicitação e realizar o contato autorizado. O envio não constitui contratação, aceite do caso ou garantia de atendimento.'),
    FORM_CONFIG.controllerIdentification
      ? element('p', {}, `Controladora: ${FORM_CONFIG.controllerIdentification}`)
      : element('p', { className: 'review-notice' }, 'A identificação formal da controladora e a política de privacidade aguardam revisão jurídica antes da publicação.'),
  );
  if (FORM_CONFIG.privacyPolicyUrl) {
    privacy.append(element('a', { href: FORM_CONFIG.privacyPolicyUrl, target: '_blank', rel: 'noopener noreferrer', className: 'privacy-link' }, 'Consultar Política de Privacidade'));
  }
  const consents = element('fieldset', { className: 'choice-list consent-list', 'aria-describedby': 'privacy-error' });
  consents.append(element('legend', { className: 'sr-only' }, 'Privacidade e autorizações'));
  const privacyControl = appendConsent(consents, {
    id: 'privacyAcknowledged',
    text: 'Declaro ciência sobre a finalidade deste formulário e sobre o aviso de privacidade apresentado.',
  });
  const contactControl = appendConsent(consents, {
    id: 'contactConsent',
    text: 'Autorizo contato relacionado a esta solicitação por WhatsApp e telefone.',
  });
  const privacyError = createError('privacy-error');
  const clearConsentError = () => {
    if (privacyControl.checked && contactControl.checked) {
      privacyControl.removeAttribute('aria-invalid');
      contactControl.removeAttribute('aria-invalid');
      clearError(null, privacyError);
    }
  };
  privacyControl.addEventListener('change', clearConsentError);
  contactControl.addEventListener('change', clearConsentError);
  const submitButton = element('button', { type: 'submit', className: 'button button--primary' }, 'Enviar formulário');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    const checkedName = validateName(name.input.value);
    const checkedPhone = validatePhone(phone.input.value);
    if (!checkedName.valid) return showError(name.input, name.error, checkedName.error);
    if (!checkedPhone.valid) return showError(phone.input, phone.error, checkedPhone.error);
    if (!privacyControl.checked || !contactControl.checked) {
      return showError(!privacyControl.checked ? privacyControl : contactControl, privacyError,
        'Confirme a ciência do aviso e a autorização de contato para concluir.');
    }
    answers = { ...answers, name: checkedName.value, phone: checkedPhone.value,
      privacyAcknowledged: true, contactConsent: true };
    submitting = true;
    submitButton.disabled = true;
    submitButton.textContent = 'Enviando...';
    form.setAttribute('aria-busy', 'true');
    try {
      const result = await submitLead({ submissionId, answers, attribution,
        privacyNoticeVersion: FORM_CONFIG.privacyNoticeVersion }, submissionId);
      renderResult(result);
    } catch (error) {
      showError(null, privacyError, error?.message || 'Não foi possível registrar suas informações. Tente novamente.');
    } finally {
      submitting = false;
      submitButton.disabled = false;
      submitButton.textContent = 'Enviar formulário';
      form.removeAttribute('aria-busy');
    }
  });
  form.append(element('div', { className: 'contact-grid' }), privacy, consents, privacyError, submitButton);
  form.querySelector('.contact-grid').append(name.group, phone.group);
}

function renderStep(index) {
  currentStep = index;
  clearApp();
  const question = questions[currentStep];
  const shell = element('section', { className: 'form-shell', 'aria-labelledby': 'question-title' });
  const card = element('div', { className: 'card card--question' });
  const form = element('form', { novalidate: '' });
  if (question.type === 'choice') createChoiceQuestion(question, form);
  else createContactQuestion(form);
  const topbar = element('div', { className: `step-topbar${currentStep === 0 ? ' step-topbar--no-back' : ''}` });
  if (currentStep > 0) {
    const back = createButton('', 'back-button');
    back.setAttribute('aria-label', 'Voltar para a etapa anterior');
    back.append(element('span', { className: 'back-button__icon', 'aria-hidden': 'true' }, '←'),
      element('span', { className: 'back-button__label' }, 'Voltar'));
    back.addEventListener('click', () => { if (!submitting) renderStep(previousStepIndex()); });
    topbar.append(back);
  }
  topbar.append(createProgress());
  card.append(element('h1', { id: 'question-title', tabindex: '-1' }, question.title), form);
  shell.append(topbar, card);
  app.append(shell);
  focusPrimary();
}

function renderResult(result) {
  currentStep = questions.length;
  clearApp();
  let whatsappUrl;
  try {
    const candidate = new URL(result.whatsappUrl);
    if (candidate.protocol === 'https:' && candidate.hostname === 'wa.me') whatsappUrl = candidate.href;
  } catch {
    whatsappUrl = undefined;
  }
  const eligible = result.completionAction === 'whatsapp'
    && result.whatsappEligible === true && Boolean(whatsappUrl);
  const pending = result.completionAction === 'financial_review';
  const card = element('section', { className: 'card card--result', 'aria-labelledby': 'result-title' });
  card.append(
    element('p', { className: 'eyebrow' }, 'Formulário concluído'),
    element('h1', { id: 'result-title', tabindex: '-1' }, eligible
      ? 'Solicitação recebida'
      : 'Informações recebidas'),
    element('p', { className: 'lead' }, eligible
      ? 'Recebemos suas informações. Para dar continuidade à solicitação de atendimento jurídico particular, toque no botão abaixo.'
      : pending
        ? 'Recebemos suas informações. A possibilidade de contratação depende da confirmação das condições de atendimento e honorários.'
        : 'Suas informações foram recebidas. Neste momento, não será possível dar continuidade à solicitação por este canal. Agradecemos seu interesse.'),
  );
  if (eligible) {
    const link = element('a', { className: 'button button--primary', href: whatsappUrl,
      target: '_blank', rel: 'noopener noreferrer' }, 'Continuar pelo WhatsApp');
    card.append(link);
  }
  app.append(card);
  focusPrimary();
}

renderIntro();
