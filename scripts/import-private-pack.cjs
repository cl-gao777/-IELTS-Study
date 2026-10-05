/* eslint-disable @typescript-eslint/no-require-imports -- Offline Node importer. */
// Import a reviewed manifest of learner-provided reading PDFs. The manifest and
// copyrighted content belong in private storage, never in the public repository.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { manualPracticeSchema, officialResourceSchema } = require('./practice-schema.cjs');

const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const descriptorKey = { questions: 'questionDocuments', answers: 'answerDocuments' };
const paperIdentity = (sha256, questions) => sha256 + ':' + JSON.stringify(questions.map((q, index) => ({
  number: q.originalQuestionNumber ?? index + 1, kind: q.kind, answers: [...q.answers].sort(),
  maxWords: q.maxWords, grouped: Boolean(q.answerGroup), targets: q.answerGroupTargets,
})));

async function main() {
  if (!process.argv[2]) throw new Error('Provide a reviewed private pack manifest.');
  const manifest = path.resolve(process.argv[2]);
  const pack = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  if (pack.format !== 'ielts-studio-private-pack' || !Array.isArray(pack.sets) || !pack.sets.length) throw new Error('Invalid private pack.');
  const identities = new Set();
  const files = new Map();
  for (const set of pack.sets) {
    if (!/^user-reading-[a-z0-9-]+$/.test(set.id) || identities.has(set.id) || set.kind !== 'reading') throw new Error('Invalid or repeated reading identity.');
    identities.add(set.id);
    const validated = manualPracticeSchema.parse({ questions: set.questions, durationMinutes: set.durationMinutes });
    set.questions = validated.questions; set.durationMinutes = validated.durationMinutes;
    if (!set.title?.trim() || !set.provider?.trim() || !set.verifiedAt?.trim() || !set.copyright?.trim()) throw new Error('Missing provenance.');
    if (!Array.isArray(set.documents) || !set.documents.some((d) => d.role === 'questions')) throw new Error('Question PDF missing.');
    for (const document of set.documents) {
      if (!descriptorKey[document.role] || !document.label || !document.localPath) throw new Error('Invalid PDF metadata.');
      document.localPath = path.resolve(path.dirname(manifest), document.localPath);
      const bytes = fs.readFileSync(document.localPath);
      if (path.extname(document.localPath).toLowerCase() !== '.pdf' || bytes.subarray(0, 5).toString() !== '%PDF-' || bytes.length > 25 * 1024 * 1024) throw new Error('Expected a PDF of at most 25 MB.');
      const sha256 = hash(bytes);
      if (document.sha256 !== sha256) throw new Error('PDF changed since review: ' + document.localPath);
      files.set(sha256, { ...document, bytes, content: document.content || files.get(sha256)?.content || '' });
    }
    set.resource = officialResourceSchema.parse({
      provider: set.provider, classification: 'user-supplied', copyright: set.copyright,
      verifiedAt: set.verifiedAt, notes: set.notes || '', issues: set.issues || [],
      collectionYear: set.collectionYear, originalFileName: path.basename(set.documents[0].localPath),
      originalPath: set.documents[0].localPath, bandEstimateAllowed: false,
      questionDocuments: set.documents.filter((d) => d.role === 'questions').map((d) => ({ label: d.label, url: '/api/uploads/1', page: d.page, sha256: d.sha256 })),
    });
    if (set.questions.length && !set.documents.some((d) => d.role === 'answers')) throw new Error('Scored practice must retain its answer PDF.');
  }

  const dbPath = path.resolve((process.env.DATABASE_URL || 'file:./data/ists.db').replace(/^file:/, ''));
  if (!fs.existsSync(dbPath)) throw new Error('Start IELTS Studio before importing.');
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON'); db.pragma('busy_timeout = 5000');
  const uploads = path.resolve(process.env.UPLOAD_DIR || './data/uploads');
  const report = []; const pending = [];
  try {
    const installedPapers = new Map();
    for (const row of db.prepare("SELECT id, questions_json, resource_json FROM practice_sets").all()) {
      const resource = JSON.parse(row.resource_json);
      if (resource.classification === 'user-supplied' && resource.questionDocuments?.[0]?.sha256) {
        installedPapers.set(paperIdentity(resource.questionDocuments[0].sha256, JSON.parse(row.questions_json)), row.id);
      }
    }
    for (const set of pack.sets) {
      const previous = db.prepare('SELECT questions_json, resource_json FROM practice_sets WHERE id=?').get(set.id);
      if (!previous) {
        const identity = paperIdentity(set.documents[0].sha256, set.questions);
        const existing = installedPapers.get(identity);
        if (existing) { report.push({ id: set.id, status: 'duplicate paper', existingId: existing }); continue; }
        installedPapers.set(identity, set.id); pending.push(set); continue;
      }
      const resource = JSON.parse(previous.resource_json);
      const oldHash = resource.questionDocuments?.[0]?.sha256;
      if (oldHash !== set.documents[0].sha256 || JSON.stringify(JSON.parse(previous.questions_json)) !== JSON.stringify(set.questions)) throw new Error('Existing set differs; refusing to replace learning history: ' + set.id);
      report.push({ id: set.id, status: 'already installed' });
    }
    if (!pending.length) { console.log(JSON.stringify({ addedSets: 0, addedFiles: 0, sets: report })); return; }
    fs.mkdirSync(uploads, { recursive: true });
    const backupDir = path.join(path.dirname(dbPath), 'backups'); fs.mkdirSync(backupDir, { recursive: true });
    const safetyBackup = path.join(backupDir, 'before-private-pack-' + Date.now() + '.db');
    await db.backup(safetyBackup);
    const localFiles = new Map();
    for (const material of db.prepare("SELECT id, file_path FROM source_materials WHERE mime_type='application/pdf' AND file_path<>''").all()) {
      if (fs.existsSync(material.file_path)) localFiles.set(hash(fs.readFileSync(material.file_path)), material.id);
    }
    const addedFiles = []; const now = new Date().toISOString();
    const insertMaterial = db.prepare('INSERT INTO source_materials(title,kind,content,source_url,file_name,mime_type,file_path,created_at) VALUES(?,?,?,?,?,?,?,?)');
    const insertSet = db.prepare('INSERT INTO practice_sets(id,kind,title,subtitle,instructions,passage,transcript,audio_url,duration_minutes,questions_json,resource_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
    try {
      db.transaction(() => {
        for (const set of pending) {
          const resource = { ...set.resource, questionDocuments: [], answerDocuments: [] };
          for (const document of set.documents) {
            let materialId = localFiles.get(document.sha256);
            if (!materialId) {
              const reviewed = files.get(document.sha256);
              const stored = path.join(uploads, crypto.randomUUID() + '.pdf');
              fs.writeFileSync(stored, reviewed.bytes); addedFiles.push(stored);
              materialId = Number(insertMaterial.run(set.title, 'reading', '用户提供，原文件与来源保存在本机。\nOriginal: ' + document.localPath + '\nSHA256: ' + document.sha256 + '\n\n' + reviewed.content, '', path.basename(document.localPath), 'application/pdf', stored, now).lastInsertRowid);
              localFiles.set(document.sha256, materialId);
            }
            resource[descriptorKey[document.role]].push({ label: document.label, url: '/api/uploads/' + materialId, sourceUrl: '', page: document.page, sha256: document.sha256 });
          }
          officialResourceSchema.parse(resource);
          insertSet.run(set.id, 'reading', set.title, set.subtitle || '用户提供的阅读资料', set.instructions || '阅读原 PDF，按题号作答。', '', '', '', set.durationMinutes, JSON.stringify(set.questions), JSON.stringify(resource), now);
          report.push({ id: set.id, status: 'installed', questions: set.questions.length });
        }
      })();
      console.log(JSON.stringify({ safetyBackup, addedSets: pending.length, addedFiles: addedFiles.length, questions: pending.reduce((n, s) => n + s.questions.length, 0), sets: report }, null, 2));
    } catch (error) {
      for (const file of addedFiles) fs.unlinkSync(file);
      throw error;
    }
  } finally { db.close(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
