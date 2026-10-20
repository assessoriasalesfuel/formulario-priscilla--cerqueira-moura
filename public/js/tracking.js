const trackedOnce = new Set();

function send(method, eventName, parameters, uniqueKey) {
  if (uniqueKey && trackedOnce.has(uniqueKey)) return false;
  if (typeof globalThis.fbq !== 'function') return false;
  globalThis.fbq(method, eventName, parameters);
  if (uniqueKey) trackedOnce.add(uniqueKey);
  return true;
}

export function trackCustomEvent(eventName, parameters = {}, uniqueKey) {
  return send('trackCustom', eventName, parameters, uniqueKey);
}

export function trackStandardEvent(eventName, parameters = {}, uniqueKey) {
  return send('track', eventName, parameters, uniqueKey);
}
