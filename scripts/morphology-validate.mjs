import fs from 'node:fs';
import assert from 'node:assert/strict';
import { morphologyLessonSchema, normaliseMorphologyAnswer, morphologyContextPrompt } from '../src/lib/morphology.ts';

const bundle = JSON.parse(fs.readFileSync(new URL('../src/data/morphology-curriculum.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(new URL('./morphology-source-manifest.json', import.meta.url), 'utf8'));
const facts = JSON.parse(fs.readFileSync(new URL('./morphology-cefr-facts.json', import.meta.url), 'utf8'));
assert.equal(bundle.version, 2);
assert.equal(bundle.lessons.length, 160);
const sources = new Map(Object.values(manifest.sources).map(source => [source.id, source]));
const words = new Map(), seenLessons = new Set();
for (const [kind, expected] of Object.entries({ root: 80, prefix: 40, suffix: 40 })) {
  assert.equal(bundle.lessons.filter(lesson => lesson.kind === kind).length, expected);
}
for (const raw of bundle.lessons) {
  const lesson = morphologyLessonSchema.parse(raw);
  assert.equal(lesson.version, 2, lesson.id);
  assert.equal(lesson.status, 'published', lesson.id);
  assert.equal(lesson.titleZh, lesson.meaningZh, `${lesson.id}: no duplicate form in title`);
  assert.ok(!seenLessons.has(lesson.id), lesson.id);
  seenLessons.add(lesson.id);
  assert.equal(new Set(lesson.meaningDistractors).size, 3, lesson.id);
  for (const word of lesson.words) {
    assert.equal(new Set(word.examples.map(example => example.sentence)).size, word.examples.length, word.id);
    for (const example of word.examples) {
      const escaped = example.targetSurface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      assert.match(example.sentence, new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, 'i'), example.id);
      assert.ok(example.acceptedAnswers.some(answer => normaliseMorphologyAnswer(answer) === normaliseMorphologyAnswer(example.targetSurface)), example.id);
      assert.ok(morphologyContextPrompt(example).includes('______'), example.id);
      assert.ok(!new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, 'i').test(morphologyContextPrompt(example)), `${example.id}: target leaked`);
    }
    if (word.level) {
      assert.ok(facts.some(fact => normaliseMorphologyAnswer(fact.term) === normaliseMorphologyAnswer(word.term) && fact.level === word.level && fact.partOfSpeech === word.partOfSpeech && word.levelSource.includes(fact.note)), `${word.id}: unverifiable CEFR label`);
    } else {
      assert.ok(word.levelSource.includes('不推定为基础词'), word.id);
    }
    for (const id of word.sourceIds) {
      const source = sources.get(id);
      assert.ok(source?.revision > 0 && source.reviewedAt === '2026-10-22', `${word.id}: missing actual revision`);
      assert.ok(source.url.includes(`oldid=${source.revision}`), id);
      assert.ok(source.etymologies.length || source.definitions.length, id);
    }
    const core = JSON.stringify([word.term, word.partOfSpeech, word.meaningZh, word.definitionEn, word.examples]);
    if (words.has(word.id)) assert.equal(words.get(word.id), core, `${word.id}: same sense differs across lessons`);
    words.set(word.id, core);
  }
}
assert.ok(!bundle.lessons.some(lesson => lesson.id === 'morph-root-rect'), 'reg/rect must be one topic');
assert.ok(bundle.lessons.some(lesson => lesson.id === 'morph-root-rupt'), 'independent replacement root required');
assert.ok(!bundle.lessons.find(lesson => lesson.id === 'morph-suffix-hood').words.some(word => word.term === 'livelihood'));
console.log(`Verified ${bundle.lessons.length} lessons, ${words.size} stable word senses, real revisions, exact cloze targets and offline schema compatibility.`);
