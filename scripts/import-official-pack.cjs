/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS importer. */
/* Import already-downloaded, source-verified documents into this private installation.
 * Usage: node scripts/import-official-pack.cjs C:/path/to/verified-pack.json
 * No network calls. No replacement of existing sets or learning records.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { manualPracticeSchema, officialResourceSchema, validateReadingPassages } = require('./practice-schema.cjs');
const { manifestReadingPassages, reviewedDocument } = require('./reading-passages.cjs');

async function main() {
  const manifestPath = path.resolve(process.argv[2] || '');
  if (!process.argv[2]) throw new Error('Provide a verified local resource manifest.');
  const pack = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (pack.format !== 'ielts-studio-official-pack' || !Array.isArray(pack.sets) || !pack.sets.length) throw new Error('Invalid pack format.');
  const roles = ['questions', 'answers', 'audio', 'transcript'];
  const allowedHosts = ['ielts.org', 'cdn.ielts.org', 'www.ielts.org', 'takeielts.britishcouncil.org', 'www.britishcouncil.org', 'ielts.idp.com', 'assets.cambridge.org', 'www.cambridgeenglish.org', 'www.cambridgeenglish.cn'];
  function officialUrl(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !allowedHosts.includes(url.hostname)) throw new Error('Unverified official source: ' + value);
    return value;
  }
  const seenSets = new Set();
  for (const set of pack.sets) {
    if (!/^official-[a-z0-9-]+$/.test(set.id) || seenSets.has(set.id) || !['reading', 'listening'].includes(set.kind)) throw new Error('Invalid or repeated set identity.');
    seenSets.add(set.id);
    if (!set.title || !set.provider || !set.copyright || !set.verifiedAt || !['official-practice', 'authentic-practice'].includes(set.classification)) throw new Error('Missing provenance.');
    officialUrl(set.sourceUrl); officialUrl(set.licenseUrl);
    if (!Array.isArray(set.documents) || !set.documents.some(d => d.role === 'questions')) throw new Error('Question paper missing.');
    if (set.kind === 'listening' && !set.documents.some(d => d.role === 'audio')) throw new Error('Listening recording missing.');
    for (const document of set.documents) {
      officialUrl(document.sourceUrl);
      if (!roles.includes(document.role) || !document.label || !document.localPath) throw new Error('Invalid document metadata.');
      document.localPath = path.resolve(path.dirname(manifestPath), document.localPath);
      const bytes = fs.readFileSync(document.localPath);
      if (!bytes.length || bytes.length > 50 * 1024 * 1024) throw new Error('Empty or oversized document.');
      const extension = path.extname(document.localPath).toLowerCase();
      if (document.role !== 'audio' && (extension !== '.pdf' || bytes.subarray(0, 5).toString() !== '%PDF-')) throw new Error('Expected an original PDF: ' + document.localPath);
      if (document.role === 'audio' && !['.mp3', '.wav', '.m4a'].includes(extension)) throw new Error('Unsupported recording.');
      const hash = crypto.createHash('sha256').update(bytes).digest('hex');
      if (document.sha256 && document.sha256 !== hash) throw new Error('Document hash changed: ' + document.localPath);
      document.sha256 = hash;
    }
    if (!Array.isArray(set.questions) || !set.questions.length || set.questions.length > 80 || new Set(set.questions.map(q => q.id)).size !== set.questions.length) throw new Error('Invalid question list.');
    for (const question of set.questions) {
      if (!question.id || !question.kind || !question.prompt || !Array.isArray(question.answers) || !question.answers.length || question.answers.some(a => typeof a !== 'string' || !a.trim())) throw new Error('Missing verified answer.');
    }
    const validated = manualPracticeSchema.parse({ questions: set.questions, durationMinutes: set.durationMinutes });
    set.questions = validated.questions;
    set.durationMinutes = validated.durationMinutes;
    const placeholderIds = new Map();
    const descriptors = set.documents.map((document) => {
      const identity = document.sourceUrl + ':' + document.sha256;
      if (!placeholderIds.has(identity)) placeholderIds.set(identity, placeholderIds.size + 1);
      return reviewedDocument(document, '/api/uploads/' + placeholderIds.get(identity));
    });
    const resource = officialResourceSchema.parse({
      provider: set.provider, classification: set.classification, sourceUrl: set.sourceUrl, licenseUrl: set.licenseUrl,
      copyright: set.copyright, verifiedAt: set.verifiedAt, notes: set.notes || '', bandEstimateAllowed: set.bandEstimateAllowed !== false,
      questionDocuments: descriptors.filter((d) => d.role === 'questions'), answerDocuments: descriptors.filter((d) => d.role === 'answers'),
      audioTracks: descriptors.filter((d) => d.role === 'audio'), transcriptDocuments: descriptors.filter((d) => d.role === 'transcript'),
      readingPassages: manifestReadingPassages(set.readingPassages, descriptors),
    });
    validateReadingPassages({ kind: set.kind, questions: set.questions, resource });
  }

  const databasePath = path.resolve((process.env.DATABASE_URL || 'file:./data/ists.db').replace(/^file:/, ''));
  if (!fs.existsSync(databasePath)) throw new Error('Start IELTS Studio once before importing.');
  const database = new Database(databasePath);
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 5000');
  if (!database.prepare('PRAGMA table_info(practice_sets)').all().some(c => c.name === 'resource_json')) throw new Error('Update and restart IELTS Studio before importing this pack.');
  const uploads = path.resolve(process.env.UPLOAD_DIR || './data/uploads');
  const backups = path.join(path.dirname(databasePath), 'backups');
  fs.mkdirSync(uploads, { recursive: true }); fs.mkdirSync(backups, { recursive: true });
  const safety = path.join(backups, 'before-official-pack-' + Date.now() + '.db');
  await database.backup(safety);
  const addedFiles = [];
  const now = new Date().toISOString();
  const report = [];
  const insertMaterial = database.prepare('INSERT INTO source_materials(title,kind,content,source_url,file_name,mime_type,file_path,created_at) VALUES(?,?,?,?,?,?,?,?)');
  const insertSet = database.prepare('INSERT INTO practice_sets(id,kind,title,subtitle,instructions,passage,transcript,audio_url,duration_minutes,questions_json,resource_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
  const localBySource = new Map();
  try {
    database.transaction(() => {
      for (const set of pack.sets) {
        if (database.prepare('SELECT 1 FROM practice_sets WHERE id=?').get(set.id)) { report.push({ id: set.id, status: 'already installed' }); continue; }
        const resource = { provider: set.provider, classification: set.classification, sourceUrl: set.sourceUrl, licenseUrl: set.licenseUrl, copyright: set.copyright, verifiedAt: set.verifiedAt, notes: set.notes || '', bandEstimateAllowed: set.bandEstimateAllowed !== false, questionDocuments: [], answerDocuments: [], audioTracks: [], transcriptDocuments: [] };
        const descriptors = [];
        for (const document of set.documents) {
          // A publisher ZIP can contain several different PDFs at one URL.
          const fileIdentity = document.sourceUrl + ':' + document.sha256;
          let materialId = localBySource.get(fileIdentity);
          if (!materialId) {
            const extension = path.extname(document.localPath).toLowerCase();
            const stored = path.join(uploads, crypto.randomUUID() + extension);
            fs.copyFileSync(document.localPath, stored); addedFiles.push(stored);
            const mime = { '.pdf': 'application/pdf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4' }[extension];
            materialId = Number(insertMaterial.run(set.provider + ' · ' + set.title + ' · ' + document.label, set.kind, set.copyright + '\n官方原文件，保留全部版权标识，仅个人学习使用。\nSource: ' + document.sourceUrl + '\nSHA256: ' + document.sha256, document.sourceUrl, path.basename(document.localPath), mime, stored, now).lastInsertRowid);
            localBySource.set(fileIdentity, materialId);
          }
          const descriptor = reviewedDocument(document, '/api/uploads/' + materialId);
          descriptors.push(descriptor);
          const { role, ...asset } = descriptor;
          resource[{questions:'questionDocuments',answers:'answerDocuments',audio:'audioTracks',transcript:'transcriptDocuments'}[role]].push(asset);
        }
        resource.readingPassages = manifestReadingPassages(set.readingPassages, descriptors);
        officialResourceSchema.parse(resource);
        validateReadingPassages({ kind: set.kind, questions: set.questions, resource });
        insertSet.run(set.id, set.kind, set.title, set.provider + ' · ' + (set.classification === 'authentic-practice' ? 'Authentic practice test' : '官方公开练习'), set.instructions || '在左侧阅读官方原版试卷，在右侧按相同题号作答。答案与学习记录保存在本机。', '', '', resource.audioTracks[0]?.url || '', set.durationMinutes, JSON.stringify(set.questions), JSON.stringify(resource), now);
        report.push({ id: set.id, status: 'installed', questions: set.questions.length, files: set.documents.length });
      }
    })();
    console.log(JSON.stringify({ safetyBackup: safety, sets: report, addedFiles: addedFiles.length }, null, 2));
  } catch (error) {
    for (const file of addedFiles) fs.unlinkSync(file);
    throw error;
  } finally { database.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
