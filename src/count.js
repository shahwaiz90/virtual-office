function count(text) {
  const lines = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  const words = text.split(/\s+/).filter(Boolean).length;
  return { lines, words, chars: text.length };
}

module.exports = { count };
