import { questions } from './questions.js';
import {
  formatBrazilianPhone, normalizeEmail, normalizeName, validateEmail, validateName,
  validatePhone,
} from './validation.js';
import { completeLead, createLead, registerWhatsAppAccess, updateLead } from './leadGateway.js';
import { captureAttribution } from './attribution.js';
import {
  trackFormCompleted, trackFormStarted, trackQualifiedLead, trackWhatsAppContact,
} from './metaPixel.js';

const app = document.querySelector('#app');
const attribution = captureAttribution();
const initialAnswers = () => ({
  name: '', phone: '', email: '', situation: '', income: '', pensionRange: '', urgency: '', hiring: '',
  dataConsent: false, contactConsent: false,
});

let answers = initialAnswers();
let currentStep = -1;
let navigationLocked = false;
let submitting = false;
let leadId = null;
let leadCreationPromise = null;
let creationKey = crypto.randomUUID();
let autoAdvanceTimer;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function element(tag, attributes = {}, text = '') {
  const node = document.createElement(tag);
  Object.entries(attributes).forEach(([key, value]) => {
    if (key === 'className') node.className = value;
    else if (key === 'disabled') node.disabled = value;
    else node.setAttribute(key, value);
  });
  if (text) node.textContent = text;
  return node;
}

function clearApp() {
  clearTimeout(autoAdvanceTimer);
  app.replaceChildren();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function focusPrimary() {
  requestAnimationFrame(() => {
    const target = app.querySelector('[data-autofocus], h1');
    target?.focus({ preventScroll: true });
  });
}

function createButton(label, className = 'button button--primary') {
  return element('button', { type: 'button', className }, label);
}

function renderIntro() {
  currentStep = -1;
  clearApp();
  const card = element('section', { className: 'card card--intro', 'aria-labelledby': 'intro-title' });
  const eyebrow = element('p', { className: 'eyebrow' }, 'Análise inicial');
  const title = element('h1', { id: 'intro-title', tabindex: '-1' }, 'Entenda o próximo passo para a sua situação');
  const copy = element('p', { className: 'lead' }, 'Responda algumas perguntas rápidas para identificarmos como podemos ajudar.');
  const time = element('p', { className: 'time-note' }, 'Leva aproximadamente 1 minuto.');
  const button = createButton('Começar');
  button.addEventListener('click', () => {
    trackFormStarted();
    renderStep(0);
  });
  card.append(eyebrow, title, copy, time, button);
  app.append(card);
  focusPrimary();
}

function createProgress() {
  const wrapper = element('div', { className: 'progress' });
  const label = element('p', { className: 'progress__label', 'aria-live': 'polite' }, `Etapa ${currentStep + 1} de ${questions.length}`);
  const track = element('div', { className: 'progress__track', role: 'progressbar', 'aria-valuemin': '1', 'aria-valuemax': String(questions.length), 'aria-valuenow': String(currentStep + 1), 'aria-label': 'Progresso do formulário' });
  const fill = element('span', { className: 'progress__fill' });
  fill.style.width = `${((currentStep + 1) / questions.length) * 100}%`;
  track.append(fill);
  wrapper.append(label, track);
  return wrapper;
}

function createError(id) {
  return element('p', { id, className: 'field-error', role: 'alert', hidden: '' });
}

function showError(control, errorNode, message) {
  errorNode.textContent = message;
  errorNode.hidden = false;
  control.setAttribute('aria-invalid', 'true');
  control.focus();
}

function clearError(control, errorNode) {
  errorNode.hidden = true;
  errorNode.textContent = '';
  control.removeAttribute('aria-invalid');
}

function friendlySaveError(error) {
  return error?.message || 'Não foi possível salvar suas respostas. Tente novamente.';
}

async function ensureLeadCreated() {
  if (leadId) return leadId;
  if (!leadCreationPromise) {
    leadCreationPromise = createLead({
      name: answers.name,
      phone: answers.phone,
      email: answers.email,
      ...attribution,
    }, creationKey).then((result) => {
      leadId = result.leadId;
      return leadId;
    }).catch((error) => {
      leadCreationPromise = null;
      throw error;
    });
  }
  return leadCreationPromise;
}

function createTextQuestion(question, form) {
  const group = element('div', { className: 'field-group' });
  const label = element('label', { for: question.id }, question.label);
  const input = element('input', {
    id: question.id, name: question.id, type: question.type, autocomplete: question.autocomplete,
    inputmode: question.inputMode, maxlength: String(question.maxLength), required: '',
    'aria-describedby': `${question.id}-error`, 'data-autofocus': '',
  });
  input.value = question.id === 'phone' ? formatBrazilianPhone(answers.phone) : answers[question.id];
  const error = createError(`${question.id}-error`);
  if (question.id === 'phone') {
    input.addEventListener('input', () => {
      input.value = formatBrazilianPhone(input.value);
      clearError(input, error);
    });
  } else {
    input.addEventListener('input', () => clearError(input, error));
  }
  input.addEventListener('blur', () => {
    if (question.id === 'name') input.value = normalizeName(input.value);
    if (question.id === 'email') input.value = normalizeEmail(input.value);
  });
  const submitButton = element('button', { type: 'submit', className: 'button button--primary' }, 'Continuar');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (navigationLocked || submitting) return;
    const result = question.id === 'name' ? validateName(input.value)
      : question.id === 'phone' ? validatePhone(input.value) : validateEmail(input.value);
    if (!result.valid) return showError(input, error, result.error);
    clearError(input, error);
    answers[question.id] = result.value;
    submitting = true;
    submitButton.disabled = true;
    try {
      if (question.id === 'email') {
        if (leadId) await updateLead(leadId, { email: result.value });
        else await ensureLeadCreated();
      }
      else if (leadId) await updateLead(leadId, { [question.id]: result.value });
      goNext();
    } catch (saveError) {
      showError(input, error, friendlySaveError(saveError));
    } finally {
      submitting = false;
      submitButton.disabled = false;
    }
  });
  group.append(label, input, error);
  form.append(group, submitButton);
}

function createChoiceQuestion(question, form) {
  const fieldset = element('fieldset', { className: 'choice-list', 'aria-describedby': `${question.id}-hint ${question.id}-error` });
  const legend = element('legend', { className: 'sr-only' }, question.title);
  const hint = element('p', { id: `${question.id}-hint`, className: 'selection-hint' }, 'Selecione uma opção para continuar.');
  const error = createError(`${question.id}-error`);
  fieldset.append(legend, hint);
  question.options.forEach(([value, labelText], index) => {
    const label = element('label', { className: 'choice' });
    const input = element('input', { type: 'radio', name: question.id, value, ...(index === 0 ? { 'data-autofocus': '' } : {}) });
    input.checked = answers[question.id] === value;
    const marker = element('span', { className: 'choice__marker', 'aria-hidden': 'true' });
    const text = element('span', { className: 'choice__text' }, labelText);
    input.addEventListener('change', () => {
      if (navigationLocked) return;
      answers[question.id] = value;
      navigationLocked = true;
      form.querySelectorAll('input').forEach((item) => { item.disabled = true; });
      error.hidden = true;
      autoAdvanceTimer = setTimeout(async () => {
        try {
          await updateLead(leadId, { [question.id]: value });
          navigationLocked = false;
          renderStep(currentStep + 1);
        } catch (saveError) {
          error.textContent = friendlySaveError(saveError);
          error.hidden = false;
          input.checked = false;
          form.querySelectorAll('input').forEach((item) => { item.disabled = false; });
          navigationLocked = false;
          input.focus();
        }
      }, reducedMotion.matches ? 40 : 320);
    });
    label.append(input, marker, text);
    fieldset.append(label);
  });
  form.append(fieldset, error);
}

function createConsentQuestion(form) {
  const fieldset = element('fieldset', { className: 'choice-list consent-list' });
  fieldset.append(element('legend', { className: 'sr-only' }, 'Confirmações obrigatórias'));
  const items = [
    ['dataConsent', 'Concordo com o tratamento dos meus dados para análise da solicitação.'],
    ['contactConsent', 'Autorizo o contato por WhatsApp, telefone e e-mail.'],
  ];
  items.forEach(([id, text], index) => {
    const label = element('label', { className: 'choice choice--checkbox' });
    const input = element('input', { type: 'checkbox', id, name: id, ...(index === 0 ? { 'data-autofocus': '' } : {}) });
    input.checked = answers[id];
    input.addEventListener('change', () => {
      answers[id] = input.checked;
      error.hidden = true;
    });
    label.append(input, element('span', { className: 'choice__marker', 'aria-hidden': 'true' }), element('span', { className: 'choice__text' }, text));
    fieldset.append(label);
  });
  const error = createError('consent-error');
  fieldset.setAttribute('aria-describedby', 'consent-error');
  const submitButton = element('button', { type: 'submit', className: 'button button--primary' }, 'Concluir');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    const controls = [...form.querySelectorAll('input[type="checkbox"]')];
    answers.dataConsent = controls[0].checked;
    answers.contactConsent = controls[1].checked;
    if (!answers.dataConsent || !answers.contactConsent) {
      error.textContent = 'Aceite as duas confirmações para concluir.';
      error.hidden = false;
      controls.find((control) => !control.checked)?.focus();
      return;
    }
    submitting = true;
    submitButton.disabled = true;
    try {
      const result = await completeLead(leadId, answers);
      trackFormCompleted();
      trackQualifiedLead(result.qualified);
      renderResult(result);
    } catch (saveError) {
      error.textContent = friendlySaveError(saveError);
      error.hidden = false;
    } finally {
      submitting = false;
      submitButton.disabled = false;
    }
  });
  form.append(fieldset, error, submitButton);
}

function goNext() {
  if (navigationLocked) return;
  navigationLocked = true;
  renderStep(currentStep + 1);
  navigationLocked = false;
}

function renderStep(index) {
  currentStep = index;
  clearApp();
  const question = questions[currentStep];
  const shell = element('section', { className: 'form-shell', 'aria-labelledby': 'question-title' });
  const card = element('div', { className: 'card card--question' });
  const title = element('h1', { id: 'question-title', tabindex: '-1' }, question.title);
  const form = element('form', { novalidate: '' });
  if (question.type === 'text' || question.type === 'tel' || question.type === 'email') createTextQuestion(question, form);
  else if (question.type === 'choice') createChoiceQuestion(question, form);
  else createConsentQuestion(form);
  const topbar = element('div', { className: `step-topbar${currentStep === 0 ? ' step-topbar--no-back' : ''}` });
  if (currentStep > 0) {
    const back = createButton('Voltar', 'back-button');
    back.setAttribute('aria-label', `Voltar para a etapa ${currentStep}`);
    back.addEventListener('click', () => {
      if (navigationLocked) return;
      navigationLocked = false;
      renderStep(currentStep - 1);
    });
    topbar.append(back);
  }
  topbar.append(createProgress());
  card.append(title, form);
  shell.append(topbar, card);
  app.append(shell);
  focusPrimary();
}

function renderResult(result) {
  currentStep = questions.length;
  clearApp();
  const qualified = result.qualified === true;
  const card = element('section', { className: 'card card--result', 'aria-labelledby': 'result-title' });
  card.append(element('p', { className: 'eyebrow' }, 'Análise inicial concluída'));
  const title = element('h1', { id: 'result-title', tabindex: '-1' }, qualified ? 'O próximo passo é falar com a equipe' : 'Formulário concluído');
  const copy = element('p', { className: 'lead' }, qualified
    ? 'Pelas respostas fornecidas, você pode iniciar o contato com a equipe da Dra. Priscilla.'
    : 'Neste momento, este canal de atendimento particular pode não ser o mais adequado para a sua necessidade.');
  card.append(title, copy);
  if (qualified) {
    const link = createButton('Falar pelo WhatsApp');
    link.className = 'button button--primary';
    const accessError = createError('whatsapp-error');
    link.addEventListener('click', async () => {
      if (submitting) return;
      submitting = true;
      link.disabled = true;
      accessError.hidden = true;
      try {
        const { link: whatsappLink } = await registerWhatsAppAccess(leadId);
        trackWhatsAppContact();
        window.open(whatsappLink, '_blank', 'noopener,noreferrer');
      } catch (saveError) {
        accessError.textContent = friendlySaveError(saveError);
        accessError.hidden = false;
      } finally {
        submitting = false;
        link.disabled = false;
      }
    });
    const disclaimer = element('p', { className: 'disclaimer' }, 'O preenchimento do formulário não representa contratação ou início de atendimento jurídico.');
    card.append(link, accessError, disclaimer);
  } else {
    card.append(element('p', { className: 'result-complement' }, 'Se a sua situação mudar, você poderá preencher o formulário novamente.'));
    const restart = createButton('Recomeçar formulário', 'button button--secondary');
    restart.addEventListener('click', () => {
      answers = initialAnswers();
      leadId = null;
      leadCreationPromise = null;
      creationKey = crypto.randomUUID();
      submitting = false;
      renderIntro();
    });
    card.append(restart);
  }
  app.append(card);
  focusPrimary();
}

renderIntro();

// A URL da Política de Privacidade deverá ser configurada aqui quando o documento
// definitivo existir. Nesta fase, nenhum link vazio ou política fictícia é exibido.
export const PRIVACY_POLICY_URL = null;
