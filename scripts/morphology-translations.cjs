function translationIndex(entries) {
  if (!Array.isArray(entries)) throw new Error('Missing morphology translation entries');
  const index = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry.exampleId !== 'string' || !entry.exampleId || typeof entry.sentence !== 'string'
      || !entry.sentence.trim() || typeof entry.translationZh !== 'string'
      || !/[\u3400-\u9fff]/.test(entry.translationZh) || !/[。！？]$/.test(entry.translationZh.trim())) {
      throw new Error('Invalid full-sentence translation: '+entry?.exampleId);
    }
    if (index.has(entry.exampleId)) throw new Error('Duplicate translation ID: '+entry.exampleId);
    index.set(entry.exampleId, entry);
  }
  return index;
}
function resolveTranslation(index, exampleId, sentence, wordMeaning) {
  const entry = index.get(exampleId);
  if (!entry) throw new Error('Missing sentence translation: '+exampleId);
  if (entry.sentence !== sentence) throw new Error('Translation sentence mismatch: '+exampleId);
  if (entry.translationZh.trim() === wordMeaning.trim()) throw new Error('Word gloss is not a sentence translation: '+exampleId);
  return entry.translationZh;
}
function assertTranslationCoverage(index, usedIds) {
  if (index.size !== usedIds.size || [...index.keys()].some(id => !usedIds.has(id))) throw new Error('Translation inventory does not match the published examples');
}
module.exports = { translationIndex, resolveTranslation, assertTranslationCoverage };
