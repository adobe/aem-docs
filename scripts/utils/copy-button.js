import { decorateIcons } from '../aem.js';

/**
 * Builds an icon-only button whose tooltip is its short action.
 * @param {string} className The button's own class, which also selects its icon in CSS.
 * @param {string} icon The name of the decorative icon in /icons.
 * @param {string} action The short localized action, shown as the tooltip.
 * @param {string} subject The text that completes the accessible name, if any.
 * @returns {HTMLButtonElement} The button.
 */
export function buildIconButton(className, icon, action, subject) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `icon-button ${className}`;
  button.setAttribute('aria-label', subject ? `${action}: ${subject}` : action);
  button.title = action;
  const span = document.createElement('span');
  span.className = `icon icon-${icon}`;
  span.setAttribute('aria-hidden', true);
  button.append(span);
  decorateIcons(button);
  return button;
}

/**
 * Builds a copy button and the status message announcing its result without moving focus.
 * @param {string} text The exact text to copy.
 * @param {Object} labels The localized `copy`, `copied` and `copyFailed` labels.
 * @param {string} subject The text that completes the accessible name, if any.
 * @returns {HTMLElement[]} The copy button and its status message.
 */
export function buildCopyButton(text, labels, subject) {
  const button = buildIconButton('copy-button', 'copy', labels.copy, subject);
  const status = document.createElement('span');
  status.className = 'copy-status';
  status.setAttribute('role', 'status');
  let reset;
  button.addEventListener('click', async () => {
    let copied = true;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      copied = false;
    }
    const message = copied ? labels.copied : labels.copyFailed;
    button.dataset.copyState = copied ? 'copied' : 'failed';
    button.title = message;
    status.textContent = message;
    clearTimeout(reset);
    reset = setTimeout(() => {
      delete button.dataset.copyState;
      button.title = labels.copy;
      status.textContent = '';
    }, 2000);
  });
  return [button, status];
}
