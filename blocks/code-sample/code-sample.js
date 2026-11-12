import { loadLabels } from '../../scripts/scripts.js';
import { buildCopyButton, buildIconButton } from '../../scripts/utils/copy-button.js';
import observe from '../../scripts/utils/intOb.js';

window.Prism = { manual: true };
const prism = import('../../deps/prismjs/prism-core.min.js');
const components = {};

/**
 * Builds the dialog heading from the inline title, keeping its badges and media type
 * but not its link, which would navigate the page behind the modal.
 * @param {HTMLElement|null} titleElement The generated inline sample title.
 * @param {string} title The plain sample title, used when no title element exists.
 * @returns {HTMLHeadingElement} The heading.
 */
function buildHeading(titleElement, title) {
  const heading = document.createElement('h2');
  heading.className = 'code-sample-title';
  if (!titleElement) {
    heading.textContent = title;
    return heading;
  }
  const copy = titleElement.cloneNode(true);
  copy.querySelectorAll('a').forEach((link) => link.replaceWith(...link.childNodes));
  heading.append(...copy.childNodes);
  return heading;
}

/**
 * Builds the modal view of a highlighted sample; closing releases the page scroll lock.
 * @param {HTMLElement} code The highlighted inline code element to show.
 * @param {HTMLElement} pre The inline code region, whose label the expanded region reuses.
 * @param {Object} labels The localized code-sample labels.
 * @param {HTMLElement|null} titleElement The inline title the dialog heading mirrors.
 * @param {string} title The plain sample title used for accessible names.
 * @returns {HTMLDialogElement} The dialog, appended to the sample.
 */
function buildDialog(code, pre, labels, titleElement, title) {
  const dialog = document.createElement('dialog');
  dialog.className = 'code-sample-dialog';
  if (title) dialog.setAttribute('aria-label', title);

  const head = document.createElement('div');
  head.className = 'code-sample-head';
  const heading = buildHeading(titleElement, title);
  const controls = document.createElement('div');
  controls.className = 'code-sample-controls';
  const close = buildIconButton('close-code-btn', 'close', labels.close, title);
  close.addEventListener('click', () => dialog.close());
  controls.append(...buildCopyButton(code.textContent, labels, title), close);
  head.append(heading, controls);

  const region = document.createElement('pre');
  region.setAttribute('role', 'region');
  region.setAttribute('aria-label', pre.getAttribute('aria-label') || title);
  region.tabIndex = 0;
  region.autofocus = true;
  region.append(code.cloneNode(true));

  dialog.append(head, region);
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    delete document.documentElement.dataset.codeSample;
  });
  return dialog;
}

/**
 * Adds the copy and expand controls to a highlighted sample's header.
 * @param {HTMLElement} block The code-sample block.
 * @param {HTMLElement} pre The inline code region.
 * @param {HTMLElement} code The highlighted code element.
 * @param {Object} labels The localized code-sample labels.
 */
function addControls(block, pre, code, labels) {
  const titleElement = block.querySelector('.code-sample-head > .code-sample-title');
  const title = titleElement ? titleElement.textContent.replace(/\s+/g, ' ').trim() : '';
  const expand = buildIconButton('expand-code-btn', 'expand', labels.expand, title);
  let dialog;
  expand.addEventListener('click', () => {
    if (!dialog) {
      dialog = buildDialog(code, pre, labels, titleElement, title);
      block.append(dialog);
    }
    document.documentElement.dataset.codeSample = 'expanded';
    dialog.showModal();
  });
  const controls = document.createElement('div');
  controls.className = 'code-sample-controls';
  controls.append(...buildCopyButton(code.textContent, labels, title), expand);
  (block.querySelector('.code-sample-head') || block).append(controls);
}

/**
 * Loads the code language, highlights the sample, and adds its controls.
 * @param {HTMLElement} block The code-sample block to highlight.
 */
async function highlight(block) {
  const pre = block.querySelector('pre');
  const code = block.querySelector('code');
  if (!pre || !code) return;
  const [labels] = await Promise.all([loadLabels(import.meta.url), prism]);
  const language = code.classList.contains('language-yaml') ? 'yaml' : 'json';
  if (!components[language]) {
    components[language] = language === 'yaml'
      ? import('../../deps/prismjs/components/prism-yaml.min.js')
      : import('../../deps/prismjs/components/prism-json.min.js');
  }
  await components[language];
  window.Prism.highlightElement(code);
  addControls(block, pre, code, labels);
  block.classList.add('is-highlighted');
}

export default function decorate(block) {
  observe(block, highlight);
}
