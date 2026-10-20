const META_PIXEL_ID = '959018970525443';

!function initializeMetaPixel(windowObject, documentObject, elementName, source, pixel, script, firstScript) {
  if (windowObject.fbq) return;
  pixel = windowObject.fbq = function queuePixelCall(...args) {
    if (pixel.callMethod) pixel.callMethod(...args);
    else pixel.queue.push(args);
  };
  if (!windowObject._fbq) windowObject._fbq = pixel;
  pixel.push = pixel;
  pixel.loaded = true;
  pixel.version = '2.0';
  pixel.queue = [];
  script = documentObject.createElement(elementName);
  script.async = true;
  script.src = source;
  firstScript = documentObject.getElementsByTagName(elementName)[0];
  firstScript.parentNode.insertBefore(script, firstScript);
}(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

window.fbq('init', META_PIXEL_ID);
window.fbq('track', 'PageView');
