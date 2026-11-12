export default function decorate(block) {
  const rows = [...block.querySelectorAll('tr')];
  const heading = rows.shift();
  if (!heading) return;
  heading.classList.add('table-heading-row');
  [...heading.cells].forEach((cell) => {
    const header = document.createElement('th');
    header.scope = 'col';
    header.append(...cell.childNodes);
    cell.replaceWith(header);
  });
  rows.forEach((row) => row.classList.add('table-content-row'));
}
