import { decorateIcons, getMetadata } from '../../scripts/aem.js';
import { loadLabels } from '../../scripts/scripts.js';
import { loadFragment } from '../fragment/fragment.js';

/**
 * Prepares the authored brand link and its responsive identity.
 * @param {HTMLElement} section The authored identity section.
 * @returns {HTMLElement} The decorated identity section.
 */
function decorateIdentity(section) {
  const brand = section.querySelector('p:first-child a');
  if (!brand.id) brand.id = 'header-home';
  section.dataset.home = brand.id;
  const name = document.createElement('span');
  name.className = 'header-name';
  name.append(...brand.childNodes);
  const logo = document.createElement('img');
  logo.src = new URL('./logo.svg', import.meta.url).href;
  logo.alt = '';
  logo.width = 24;
  logo.height = 24;
  brand.append(logo, name);
  return section;
}

/**
 * Prepares global navigation semantics and its stable ID.
 * @param {HTMLElement} section The authored navigation section.
 * @param {Object} labels The localized header labels.
 * @returns {HTMLElement} The decorated navigation section.
 */
function decorateNav(section, labels) {
  if (!section.id) section.id = 'header-navigation';
  const list = section.querySelector('ul');
  const wrapper = list.parentElement;
  const nav = document.createElement('nav');
  [...wrapper.attributes].forEach(({ name, value }) => nav.setAttribute(name, value));
  nav.append(...wrapper.childNodes);
  wrapper.replaceWith(nav);
  nav.setAttribute('aria-label', labels.nav || 'Global');
  return section;
}

/**
 * Builds an API selector from authored links and resolves the current destination.
 * @param {HTMLElement} section The authored API versions section.
 * @param {Object} labels The localized header labels.
 * @returns {HTMLElement} The decorated API versions section.
 */
function decorateVersion(section, labels) {
  const list = section.querySelector('ul');
  let current;
  let matchedLength = 0;
  list.querySelectorAll('a[href]').forEach((link) => {
    const { pathname } = new URL(link.href);
    const prefix = pathname.endsWith('/') ? pathname : `${pathname}/`;
    if ((window.location.pathname === pathname || window.location.pathname.startsWith(prefix))
      && pathname.length > matchedLength) {
      current = link;
      matchedLength = pathname.length;
    }
  });

  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = current ? current.textContent : labels.apiSelect;
  summary.setAttribute('aria-label', `${labels.api}: ${summary.textContent}`);
  if (current) current.setAttribute('aria-current', true);
  section.replaceChildren(details);
  details.append(summary, list);

  details.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !details.open) return;
    e.preventDefault();
    e.stopPropagation();
    details.open = false;
    summary.focus();
  });

  details.addEventListener('focusout', (e) => {
    if (e.relatedTarget && !details.contains(e.relatedTarget)) details.open = false;
  });

  document.addEventListener('click', (e) => {
    if (details.open && !details.contains(e.target)) details.open = false;
  });
  return section;
}

/**
 * Builds the menu section and owns its disclosure and focus behavior.
 * @param {HTMLElement} block The header containing the menu and navigation.
 * @param {Object} labels The localized header labels.
 * @param {HTMLElement|null} identity The decorated identity section.
 * @param {HTMLElement|null} navigation The decorated navigation section.
 * @returns {HTMLElement} The menu section containing its button.
 */
function buildMenu(block, labels, identity, navigation) {
  const menu = document.createElement('button');
  menu.type = 'button';
  menu.className = 'header-menu';
  menu.setAttribute('aria-label', labels.menuOpen);
  const icon = document.createElement('span');
  icon.className = 'icon icon-menu';
  icon.setAttribute('aria-hidden', true);
  menu.append(icon);
  decorateIcons(menu);
  const section = document.createElement('div');
  section.className = 'section header-menu';
  section.append(menu);

  if (!navigation) {
    menu.disabled = true;
    return section;
  }

  const desktop = window.matchMedia('(min-width: 900px)');
  const firstLink = navigation.querySelector('a');
  const identityLink = identity && identity.querySelector('a');

  menu.setAttribute('aria-controls', navigation.id);
  const setOpen = (open) => {
    menu.setAttribute('aria-expanded', open);
    menu.setAttribute('aria-label', open ? labels.menuClose : labels.menuOpen);
    navigation.dataset.open = open;
  };
  setOpen(false);

  menu.addEventListener('click', () => {
    if (desktop.matches) return;
    const open = menu.getAttribute('aria-expanded') !== 'true';
    setOpen(open);
    if (open) firstLink.focus();
    else menu.focus();
  });

  block.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || menu.getAttribute('aria-expanded') !== 'true') return;
    e.preventDefault();
    setOpen(false);
    menu.focus();
  });

  block.addEventListener('focusout', (e) => {
    if (e.relatedTarget && !block.contains(e.relatedTarget)) setOpen(false);
  });

  document.addEventListener('click', (e) => {
    if (menu.getAttribute('aria-expanded') === 'true'
      && !navigation.contains(e.target) && !menu.contains(e.target)) setOpen(false);
  });

  desktop.addEventListener('change', () => {
    setOpen(false);
    if (desktop.matches && document.activeElement === menu && identityLink) {
      identityLink.focus();
    }
  });
  return section;
}

export default async function decorate(block) {
  const headerMeta = getMetadata('header');
  const headerPath = headerMeta ? new URL(headerMeta, window.location).pathname : '/header/header';
  const fragment = await loadFragment(headerPath);
  if (!fragment) throw Error(`Could not load header document: ${headerPath}`);

  const sections = ['identity', 'version', 'nav'];
  [...fragment.children].forEach((child, i) => {
    if (sections[i]) child.classList.add(`header-${sections[i]}`);
  });

  const labels = await loadLabels(import.meta.url);

  const identity = fragment.querySelector('.header-identity');
  if (identity) decorateIdentity(identity);

  const version = fragment.querySelector('.header-version');
  if (version) decorateVersion(version, labels);

  const nav = fragment.querySelector('.header-nav');
  if (nav) decorateNav(nav, labels);

  const menu = buildMenu(block, labels, identity, nav);

  block.replaceChildren(...fragment.children, menu);
}
