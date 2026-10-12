/* eslint-disable @typescript-eslint/no-require-imports -- Offline private-course installer. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { validateAdvancedVocabularyPackage, hash } = require('./advanced-vocabulary-package.cjs');

async function main() {
  if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: node scripts/install-advanced-vocabulary.cjs <reviewed-private-package.json> <original-vocabulary.pdf>');
  const manifest = path.resolve(process.argv[2]), pdfPath = path.resolve(process.argv[3]);
  const input = JSON.parse(fs.readFileSync(manifest, 'utf8')), bytes = fs.readFileSync(pdfPath);
  const { catalog, summary } = validateAdvancedVocabularyPackage(input, bytes);
  const dbPath = path.resolve((process.env.DATABASE_URL || 'file:./data/ists.db').replace(/^file:/, ''));
  const uploads = path.resolve(process.env.UPLOAD_DIR || './data/uploads');
  const packagePath = path.resolve(process.env.VOCABULARY_PRIVATE_CATALOG_PATH || './data/vocabulary-private-catalog.json');
  if (!fs.existsSync(dbPath)) throw new Error('Initialize the application database before installing a private package.');
  const database = new Database(dbPath);
  database.pragma('foreign_keys = ON'); database.pragma('busy_timeout = 5000');
  const createdFiles = []; const previousPackage = fs.existsSync(packagePath) ? fs.readFileSync(packagePath) : null;
  let stagedFile; let safetyBackup;
  try {
    const materials = database.prepare("SELECT id,file_path FROM source_materials WHERE mime_type='application/pdf' AND file_path<>''").all();
    const matches = materials.filter((material) => fs.existsSync(material.file_path) && hash(fs.readFileSync(material.file_path)) === input.metadata.sourceFileSha256);
    let materialId = matches[0]?.id;
    // Back up actual current data before adding a source reference. No schedules,
    // grades, or personal definitions are created by the installer.
    const backupDir = path.join(path.dirname(dbPath), 'backups'); fs.mkdirSync(backupDir, { recursive: true });
    safetyBackup = path.join(backupDir, 'before-advanced-vocabulary-' + Date.now() + '.db');
    await database.backup(safetyBackup);
    fs.mkdirSync(uploads, { recursive: true }); fs.mkdirSync(path.dirname(packagePath), { recursive: true });
    database.transaction(() => {
      if (!materialId) {
        const storedFile = path.join(uploads, 'vocabulary-' + input.metadata.sourceFileSha256 + '.pdf');
        if (fs.existsSync(storedFile)) {
          if (hash(fs.readFileSync(storedFile)) !== input.metadata.sourceFileSha256) throw new Error('Stored private PDF has different contents.');
        } else { fs.writeFileSync(storedFile, bytes, { flag: 'wx' }); createdFiles.push(storedFile); }
        materialId = Number(database.prepare('INSERT INTO source_materials(title,kind,content,source_url,file_name,mime_type,file_path,created_at) VALUES(?,?,?,?,?,?,?,?)')
          .run('雅思进阶词汇 · 原始私人 PDF', 'vocabulary', '用户提供，仅本地使用。\n原文件：' + pdfPath + '\nSHA256: ' + input.metadata.sourceFileSha256 + '\n原始页数：' + input.metadata.sourcePages + '\n完整提取词面：' + input.metadata.sourceWordCount,
            '', input.metadata.sourceFileName, 'application/pdf', storedFile, new Date().toISOString()).lastInsertRowid);
      }
      const mapped = structuredClone(catalog);
      for (const entry of mapped.entries) for (const target of entry.targets) target.sourcePdf.attachmentUrl = '/api/uploads/' + materialId;
      const installed = { ...mapped, metadata: input.metadata };
      validateAdvancedVocabularyPackage(installed, bytes);
      stagedFile = packagePath + '.' + crypto.randomUUID() + '.tmp';
      fs.writeFileSync(stagedFile, JSON.stringify(installed, null, 2), { flag: 'wx' });
      // Same-directory rename publishes the complete package in one step. The
      // existing DB content is registered by the app's idempotent content loader.
      fs.renameSync(stagedFile, packagePath); stagedFile = null;
    })();
    console.log(JSON.stringify({ safetyBackup, materialId, packagePath, addedPdf: createdFiles.length > 0, ...summary }));
  } catch (error) {
    if (stagedFile && fs.existsSync(stagedFile)) fs.unlinkSync(stagedFile);
    for (const file of createdFiles) if (fs.existsSync(file)) fs.unlinkSync(file);
    if (previousPackage) fs.writeFileSync(packagePath, previousPackage);
    else if (fs.existsSync(packagePath)) fs.unlinkSync(packagePath);
    throw error;
  } finally { database.close(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
