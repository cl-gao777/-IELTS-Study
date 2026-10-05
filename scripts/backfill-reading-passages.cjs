/* eslint-disable @typescript-eslint/no-require-imports -- Offline reviewed metadata migration. */
// This changes only resource_json. The reviewed mapping, source texts, PDFs and
// answer lists stay private; question hashes and original files guard the patch.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { officialResourceSchema, validateReadingPassages } = require('./practice-schema.cjs');

const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const validHash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const manifestPath = args.find((arg) => !arg.startsWith('--'));
  if (!manifestPath || args.some((arg) => arg.startsWith('--') && arg !== '--dry-run')) throw new Error('Provide a reviewed reading metadata manifest, optionally --dry-run.');
  const pack = JSON.parse(fs.readFileSync(path.resolve(manifestPath), 'utf8'));
  if (pack.format !== 'ielts-studio-reading-passages' || pack.version !== 1 || !Array.isArray(pack.sets) || !pack.sets.length) throw new Error('Invalid reading metadata manifest.');
  const dbPath = path.resolve((process.env.DATABASE_URL || 'file:./data/ists.db').replace(/^file:/, ''));
  const db = new Database(dbPath, { readonly: dryRun, fileMustExist: true });
  db.pragma('busy_timeout = 5000');
  const identities = new Set();
  const materialHashes = new Map();
  function materialHash(url) {
    if (!/^\/api\/uploads\/\d+$/.test(url)) throw new Error('Expected a local PDF reference.');
    if (materialHashes.has(url)) return materialHashes.get(url);
    const material = db.prepare('SELECT mime_type,file_path FROM source_materials WHERE id=?').get(Number(url.split('/').at(-1)));
    if (!material?.file_path || material.mime_type !== 'application/pdf') throw new Error('Missing original PDF: ' + url);
    const result = hash(fs.readFileSync(material.file_path));
    materialHashes.set(url, result);
    return result;
  }
  try {
    const pending = [];
    const report = [];
    for (const entry of pack.sets) {
      if (!entry.id || identities.has(entry.id) || !validHash(entry.questionsSha256)) throw new Error('Invalid or repeated Practice Set mapping.');
      identities.add(entry.id);
      const row = db.prepare('SELECT kind,questions_json,resource_json FROM practice_sets WHERE id=?').get(entry.id);
      if (!row || row.kind !== 'reading') throw new Error('Reading Practice Set not installed: ' + entry.id);
      if (hash(row.questions_json) !== entry.questionsSha256) throw new Error('Questions changed since metadata review: ' + entry.id);
      const original = JSON.parse(row.resource_json);
      officialResourceSchema.parse(original);
      if (!Array.isArray(entry.files) || !entry.files.length || entry.files.some((file) => !validHash(file.sha256) || !Number.isInteger(file.totalPages) || file.totalPages < 1)) throw new Error('Missing reviewed PDF hashes and page counts.');
      const files = new Map(entry.files.map((file) => [file.sha256, file.totalPages]));
      if (files.size !== entry.files.length) throw new Error('Repeated PDF hash in mapping.');
      const questionDocuments = original.questionDocuments.map((document) => ({ ...document }));
      for (const document of [...questionDocuments, ...(original.answerDocuments || [])]) {
        const sha256 = materialHash(document.url);
        if (!files.has(sha256) || (document.sha256 && document.sha256 !== sha256)) throw new Error('Original PDF changed since review: ' + entry.id);
      }
      function checkRange(reference) {
        if (!validHash(reference.sha256) || !files.has(reference.sha256) || !Number.isInteger(reference.page) || !Number.isInteger(reference.endPage) || reference.page < 1 || reference.endPage < reference.page || reference.endPage > files.get(reference.sha256)) throw new Error('Invalid reviewed PDF range: ' + entry.id);
      }
      for (const patch of entry.questionDocuments || []) {
        checkRange(patch);
        if (!Number.isInteger(patch.documentIndex) || patch.documentIndex < 0 || patch.documentIndex >= questionDocuments.length || materialHash(questionDocuments[patch.documentIndex].url) !== patch.sha256) throw new Error('Question document mapping no longer matches: ' + entry.id);
        questionDocuments[patch.documentIndex].page = patch.page;
        questionDocuments[patch.documentIndex].endPage = patch.endPage;
      }
      if (!Array.isArray(entry.readingPassages) || !entry.readingPassages.length) throw new Error('Missing reviewed passages.');
      const readingPassages = entry.readingPassages.map((passage) => ({
        id: passage.id, label: passage.label, questionIds: passage.questionIds,
        documents: (passage.documents || []).map((reference) => {
          checkRange(reference);
          const originalDocument = questionDocuments.find((document) => materialHash(document.url) === reference.sha256);
          if (!originalDocument) throw new Error('Reading range is not an original question PDF: ' + entry.id);
          return { ...originalDocument, label: reference.label || originalDocument.label, sha256: reference.sha256, page: reference.page, endPage: reference.endPage };
        }),
      }));
      const updated = { ...original, questionDocuments, readingPassages };
      const parsed = officialResourceSchema.parse(updated);
      validateReadingPassages({ kind: row.kind, questions: JSON.parse(row.questions_json), resource: parsed });
      if (original.readingPassages && JSON.stringify(original.readingPassages) !== JSON.stringify(readingPassages)) throw new Error('Existing Passage mapping differs; review before replacing: ' + entry.id);
      const resourceJson = JSON.stringify(updated);
      if (resourceJson === row.resource_json) report.push({ id: entry.id, status: 'already mapped' });
      else { pending.push({ id: entry.id, original: row, resourceJson }); report.push({ id: entry.id, status: dryRun ? 'ready' : 'updated', passages: readingPassages.length, questions: JSON.parse(row.questions_json).length }); }
    }
    let safetyBackup;
    if (pending.length && !dryRun) {
      const backupDir = path.join(path.dirname(dbPath), 'backups');
      fs.mkdirSync(backupDir, { recursive: true });
      safetyBackup = path.join(backupDir, 'before-reading-passages-' + Date.now() + '-' + crypto.randomUUID() + '.db');
      await db.backup(safetyBackup);
      db.transaction(() => {
        for (const entry of pending) {
          const result = db.prepare('UPDATE practice_sets SET resource_json=? WHERE id=? AND questions_json=? AND resource_json=?').run(entry.resourceJson, entry.id, entry.original.questions_json, entry.original.resource_json);
          if (result.changes !== 1) throw new Error('Practice Set changed while metadata was being saved; rolled back: ' + entry.id);
        }
      })();
    }
    console.log(JSON.stringify({ dryRun, updatedSets: pending.length, unchangedSets: report.length - pending.length, safetyBackup, sets: report }, null, 2));
  } finally { db.close(); }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
