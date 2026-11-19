const quoted = (value) => JSON.stringify(value).replace(/\s/g, (character) => (
  `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
));

/** Readable JSONPath-like paths; literal punctuation never becomes path syntax. */
export function fieldPath(parts) {
  return parts.map((part, index) => {
    if (part.property !== undefined) {
      return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(part.property)
        ? `${index ? '.' : ''}${part.property}` : `[${quoted(part.property)}]`;
    }
    if (part.item) return '[]';
    if (part.dictionary) return `${index ? '.' : ''}*`;
    if (typeof part.pattern === 'string') return `[pattern=${quoted(part.pattern)}]`;
    throw Error('Unknown API field path part');
  }).join('');
}

export function fieldAnchor(context, parts = []) {
  return `${context}${parts.length ? `-${fieldPath(parts)}` : ''}`;
}
