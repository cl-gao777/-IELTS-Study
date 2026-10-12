import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";

const requireLocal = createRequire(import.meta.url);
const { validateAdvancedVocabularyPackage } = requireLocal("../../scripts/advanced-vocabulary-package.cjs") as {
  validateAdvancedVocabularyPackage: (input: unknown, pdf?: Buffer) => { summary: Record<string, number> };
};
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const pdf = Buffer.from("%PDF-1.4\nOffline source fixture\n%%EOF");
function fixture() {
  const sourceSha = createHash("sha256").update(pdf).digest("hex");
  const sentences = ["The council will allocate money to the school.", "Researchers allocate enough time to check the results."];
  const exercises = sentences.map((sentence, index) => ({ id: `target:allocate:${index}`, targetId: "target:allocate", version: 1,
    status: "published", sentence, targetStart: sentence.indexOf("allocate"), targetEnd: sentence.indexOf("allocate") + 8,
    targetSurface: "allocate", acceptedAnswers: ["allocate"], meaningZh: "分配", source: "Original learning example" }));
  return { courses: [{ id: "private-fixture", title: "Private advanced fixture", kind: "user-import", version: 1 }],
    entries: [{ id: "entry:allocate", term: "allocate", rank: 1, courseIds: ["private-fixture"], partOfSpeech: "verb", meaningZh: "分配",
      definitionEn: "To assign resources to a particular purpose.", exercises, targets: [{ id: "target:allocate", version: 1, status: "published", partOfSpeech: "verb", meaningZh: "分配",
        definitionEn: "To assign resources to a particular purpose.", level: "C1", headwordAnswers: [], advancedReason: "Academic allocation of resources", source: "Learner-provided local PDF",
        levelEvidence: [{ source: "Oxford", scope: "headword-pos", level: "C1", url: "https://www.oxfordlearnersdictionaries.com/about/wordlists/oxford3000-5000" },
          { source: "Reviewed teaching sense", scope: "editorial", level: "C1", note: "Both examples use allocation of resources." }],
        sourcePdf: { attachmentUrl: "/api/uploads/1", fileSha256: sourceSha, pdfPage: 1, quote: "1. allocate 分配" },
        memberships: [{ courseId: "private-fixture", version: 1, rank: 1, exerciseIds: exercises.map((exercise) => exercise.id) }] }] }],
    metadata: { format: "ielts-studio-advanced-vocabulary", version: 1, courseId: "private-fixture", sourceFileSha256: sourceSha,
      sourcePages: 1, sourceWordCount: 1, sourceFileName: "source.pdf", excluded: [], summary: { selectedTerms: 1, targetCount: 1, exerciseCount: 2 } } };
}

describe("private advanced-course content installation", () => {
  it("requires exact original bytes, primary POS evidence and two linked sense exercises", () => {
    expect(validateAdvancedVocabularyPackage(fixture(), pdf).summary.selectedTerms).toBe(1);
    expect(() => validateAdvancedVocabularyPackage(fixture(), Buffer.from("%PDF-1.4\nchanged"))).toThrow(/differs/);
    const bad = fixture(); bad.entries[0].targets[0].levelEvidence = bad.entries[0].targets[0].levelEvidence.slice(1);
    expect(() => validateAdvancedVocabularyPackage(bad, pdf)).toThrow(/primary/);
  });
  it("rejects a published exercise linked to another sense or pointing to the wrong answer span", () => {
    const wrongSense = fixture(); wrongSense.entries[0].exercises[0].targetId = "old-simple-sense";
    expect(() => validateAdvancedVocabularyPackage(wrongSense)).toThrow(/membership/);
    const wrongSpan = fixture(); wrongSpan.entries[0].exercises[0].targetStart++;
    expect(() => validateAdvancedVocabularyPackage(wrongSpan)).toThrow();
  });
  it("rejects repeated sentences, incorrect totals and out-of-range PDF provenance", () => {
    const repeated = fixture(); repeated.entries[0].exercises[1] = { ...repeated.entries[0].exercises[0], id: repeated.entries[0].exercises[1].id };
    expect(() => validateAdvancedVocabularyPackage(repeated)).toThrow(/distinct/);
    const wrongCount = fixture(); wrongCount.metadata.summary.selectedTerms = 2;
    expect(() => validateAdvancedVocabularyPackage(wrongCount)).toThrow(/totals/);
    const wrongPage = fixture(); wrongPage.entries[0].targets[0].sourcePdf.pdfPage = 2;
    expect(() => validateAdvancedVocabularyPackage(wrongPage)).toThrow(/provenance/);
  });
  it("maps the private PDF to a stable material ID and installs twice without grades or duplicate source rows", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "advanced-package-")); directories.push(directory);
    const dbPath = path.join(directory, "study.db"), manifest = path.join(directory, "package.json"), source = path.join(directory, "source.pdf");
    const packagePath = path.join(directory, "data", "vocabulary-private-catalog.json"), uploads = path.join(directory, "uploads");
    const database = new Database(dbPath);
    database.exec("CREATE TABLE source_materials(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT,kind TEXT,content TEXT,source_url TEXT,file_name TEXT,mime_type TEXT,file_path TEXT,created_at TEXT); CREATE TABLE vocabulary_words(id TEXT PRIMARY KEY,due_at TEXT,repetitions INTEGER); CREATE TABLE vocabulary_reviews(id INTEGER PRIMARY KEY,word_id TEXT,rating TEXT);");
    database.prepare("INSERT INTO vocabulary_words VALUES('existing','2030-12-01T00:00:00.000Z',17)").run();
    database.prepare("INSERT INTO vocabulary_reviews VALUES(7,'existing','good')").run();
    writeFileSync(manifest, JSON.stringify(fixture())); writeFileSync(source, pdf);
    const script = path.resolve("scripts/install-advanced-vocabulary.cjs");
    const env = { ...process.env, DATABASE_URL: "file:" + dbPath, UPLOAD_DIR: uploads, VOCABULARY_PRIVATE_CATALOG_PATH: packagePath };
    const first = JSON.parse(execFileSync(process.execPath, [script, manifest, source], { env, encoding: "utf8" }));
    const second = JSON.parse(execFileSync(process.execPath, [script, manifest, source], { env, encoding: "utf8" }));
    expect(second.materialId).toBe(first.materialId); expect(first.addedPdf).toBe(true); expect(second.addedPdf).toBe(false);
    expect(database.prepare("SELECT COUNT(*) AS n FROM source_materials").get()).toEqual({ n: 1 });
    expect(database.prepare("SELECT * FROM vocabulary_words").all()).toEqual([{ id: "existing", due_at: "2030-12-01T00:00:00.000Z", repetitions: 17 }]);
    expect(database.prepare("SELECT * FROM vocabulary_reviews").all()).toEqual([{ id: 7, word_id: "existing", rating: "good" }]);
    const installed = JSON.parse(readFileSync(packagePath, "utf8"));
    expect(installed.entries[0].targets[0].sourcePdf.attachmentUrl).toBe("/api/uploads/" + first.materialId);
    expect(readdirSync(uploads)).toHaveLength(1); database.close();
  });
  it("removes the added PDF and preserves the original package when its SQL transaction fails", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "advanced-package-rollback-")); directories.push(directory);
    const dbPath = path.join(directory, "study.db"), manifest = path.join(directory, "package.json"), source = path.join(directory, "source.pdf");
    const packagePath = path.join(directory, "existing-package.json"), uploads = path.join(directory, "uploads");
    const originalPackage = Buffer.from("previous private package bytes"); writeFileSync(packagePath, originalPackage);
    const database = new Database(dbPath);
    database.exec("CREATE TABLE source_materials(id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT,kind TEXT,content TEXT,source_url TEXT,file_name TEXT,mime_type TEXT,file_path TEXT,created_at TEXT); CREATE TRIGGER reject_material BEFORE INSERT ON source_materials BEGIN SELECT RAISE(ABORT, 'Fixture transaction failure'); END;");
    writeFileSync(manifest, JSON.stringify(fixture())); writeFileSync(source, pdf);
    expect(() => execFileSync(process.execPath, [path.resolve("scripts/install-advanced-vocabulary.cjs"), manifest, source], {
      env: { ...process.env, DATABASE_URL: "file:" + dbPath, UPLOAD_DIR: uploads, VOCABULARY_PRIVATE_CATALOG_PATH: packagePath }, stdio: "pipe",
    })).toThrow();
    expect(database.prepare("SELECT COUNT(*) AS n FROM source_materials").get()).toEqual({ n: 0 });
    expect(readdirSync(uploads)).toHaveLength(0); expect(readFileSync(packagePath)).toEqual(originalPackage); database.close();
  });
});
