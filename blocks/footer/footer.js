import { getMetadata } from '../../scripts/aem.js';
import { loadLabels } from '../../scripts/scripts.js';
import { loadFragment } from '../fragment/fragment.js';

/**
 * Gives an authored link list a labeled native navigation landmark.
 * @param {HTMLElement} section The authored navigation section.
 * @param {string} label The localized navigation purpose.
 */
function decorateNav(section, label) {
  const list = section.querySelector('ul');
  const wrapper = list.parentElement;
  const nav = document.createElement('nav');
  [...wrapper.attributes].forEach(({ name, value }) => nav.setAttribute(name, value));
  nav.append(...wrapper.childNodes);
  wrapper.replaceWith(nav);
  nav.setAttribute('aria-label', label);
}

/**
 * Loads, decorates and assembles the authored footer sections.
 * @param {HTMLElement} block The footer block element.
 */
export default async function decorate(block) {
  const footerMeta = getMetadata('footer');
  const footerPath = footerMeta ? new URL(footerMeta, window.location).pathname : '/footer/footer';
  const fragment = await loadFragment(footerPath);
  if (!fragment) throw Error(`Could not load footer document: ${footerPath}`);

  const sections = ['identity', 'copyright', 'legal'];
  [...fragment.children].forEach((child, i) => {
    if (sections[i]) child.classList.add(`footer-${sections[i]}`);
  });

  const labels = await loadLabels(import.meta.url);

  const legal = fragment.querySelector('.footer-legal');
  if (legal) decorateNav(legal, labels.legal);

  block.replaceChildren(...fragment.children);
}
