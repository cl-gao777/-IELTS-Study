/* eslint-disable @typescript-eslint/no-require-imports -- Offline content validation uses the same TypeScript schemas as the application. */
const fs = require('node:fs');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const ts = require('typescript');

function loadSchemas() {
  // The offline installer is deliberately independent of the live application
  // database. Only pure library contracts are compiled here.
  const previous = require.extensions['.ts'];
  require.extensions['.ts'] = (module, filename) => {
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    module._compile(code, filename);
  };
  try { return require('../src/lib/vocabulary-course.ts'); }
  finally { if (previous) require.extensions['.ts'] = previous; else delete require.extensions['.ts']; }
}
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
function validateAdvancedVocabularyPackage(input, pdfBytes) {
  const catalog = loadSchemas().vocabularyCatalogSchema.parse(input);
  const metadata = input.metadata;
  assert(metadata?.format === 'ielts-studio-advanced-vocabulary' && metadata.version === 1, 'Unknown private package format.');
  assert(catalog.courses.length === 1 && catalog.courses[0].id === metadata.courseId, 'Expected one named advanced course.');
  assert(/^[a-f0-9]{64}$/.test(metadata.sourceFileSha256), 'Missing source hash.');
  assert(metadata.sourcePages > 0 && Number.isInteger(metadata.sourcePages), 'Missing PDF page count.');
  if (pdfBytes) {
    assert(pdfBytes.subarray(0, 5).toString() === '%PDF-', 'Expected original PDF.');
    assert(hash(pdfBytes) === metadata.sourceFileSha256, 'Original PDF differs from the reviewed package.');
  }
  const terms = new Set(), targetIds = new Set(), exerciseIds = new Set();
  let targets = 0, exercises = 0;
  for (const entry of catalog.entries) {
    const normalized = entry.term.toLowerCase().trim().replace(/\s+/g, ' ');
    assert(!terms.has(normalized), 'Repeated canonical term: ' + entry.term); terms.add(normalized);
    assert(entry.status === 'published' && entry.targets.length > 0, 'Only complete reviewed content can be installed.');
    const byExercise = new Map(entry.exercises.map((exercise) => [exercise.id, exercise]));
    for (const target of entry.targets) {
      assert(!targetIds.has(target.id), 'Repeated target: ' + target.id); targetIds.add(target.id); targets++;
      assert(target.status === 'published' && ['B2', 'C1'].includes(target.level), 'Only reviewed B2/C1 targets are eligible.');
      assert(target.levelEvidence.some((evidence) => evidence.scope === 'headword-pos' && evidence.url && ['B2', 'C1'].includes(evidence.level)), 'Missing primary word/POS evidence: ' + entry.term);
      assert(target.levelEvidence.some((evidence) => ['sense', 'editorial'].includes(evidence.scope) && evidence.note), 'Missing separate sense evidence: ' + entry.term);
      assert(target.sourcePdf?.fileSha256 === metadata.sourceFileSha256 && target.sourcePdf.pdfPage <= metadata.sourcePages, 'Invalid original PDF provenance: ' + entry.term);
      assert(target.advancedReason && target.source, 'Missing selection reason or attribution: ' + entry.term);
      const membership = target.memberships.find((item) => item.courseId === metadata.courseId);
      assert(membership, 'Target is not linked to the selected course.');
      const sentences = new Set();
      for (const id of membership.exerciseIds) {
        const exercise = byExercise.get(id);
        assert(exercise?.status === 'published' && exercise.targetId === target.id, 'Wrong sense/exercise membership: ' + id);
        assert(exercise.meaningZh && exercise.source, 'Missing prompt or sentence attribution.');
        const sentence = exercise.sentence.toLowerCase().replace(/\s+/g, ' ').trim();
        sentences.add(sentence);
      }
      assert(sentences.size >= 2, 'At least two distinct usable exercises are required: ' + entry.term);
    }
    for (const exercise of entry.exercises) {
      assert(!exerciseIds.has(exercise.id), 'Repeated exercise: ' + exercise.id); exerciseIds.add(exercise.id); exercises++;
      assert(entry.targets.some((target) => target.id === exercise.targetId && target.memberships.some((member) => member.exerciseIds.includes(exercise.id))), 'Unbound exercise: ' + exercise.id);
    }
  }
  assert(metadata.summary?.selectedTerms === catalog.entries.length && metadata.summary.targetCount === targets && metadata.summary.exerciseCount === exercises, 'Manifest totals differ from actual contents.');
  assert(catalog.entries.length + metadata.excluded.length === metadata.sourceWordCount, 'Every extracted source term needs an inclusion or exclusion decision.');
  return { catalog, summary: metadata.summary };
}
module.exports = { validateAdvancedVocabularyPackage, hash };

if (require.main === module) {
  try {
    if (!process.argv[2]) throw new Error('Provide the private package JSON path.');
    const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const pdf = process.argv[3] ? fs.readFileSync(process.argv[3]) : undefined;
    console.log(JSON.stringify(validateAdvancedVocabularyPackage(input, pdf).summary));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
