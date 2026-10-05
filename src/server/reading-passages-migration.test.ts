import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
vi.mock("server-only", () => ({}));
import { migrate } from "./db";

const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const pdfBytes = Buffer.from("%PDF-1.7\nSynthetic two-page metadata fixture.\n");
const sha256 = hash(pdfBytes);
let directory: string;
let databasePath: string;
let manifest: string;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "ielts-passage-migration-"));
  databasePath = path.join(directory, "ists.db");
  const db = new Database(databasePath); migrate(db); db.close();
  const pdf = path.join(directory, "source.pdf"); writeFileSync(pdf, pdfBytes);
  manifest = path.join(directory, "pack.json");
  const sets = ["user-reading-first", "user-reading-second"].map((id, index) => ({
    id, kind: "reading", title: id, provider: "个人资料", copyright: "Synthetic fixture", verifiedAt: "2026-10-05", durationMinutes: 20,
    documents: [{ role: "questions", label: "Original", localPath: pdf, sha256, page: 1 }, { role: "answers", label: "Solutions", localPath: pdf, sha256, page: 2 }],
    questions: [{ id: "q2", originalQuestionNumber: 2, kind: "short-answer", prompt: "Synthetic", answers: ["sample-" + index] }],
  }));
  writeFileSync(manifest, JSON.stringify({ format: "ielts-studio-private-pack", sets }));
  execFileSync(process.execPath, [path.resolve("scripts/import-private-pack.cjs"), manifest], { env: environment(), stdio: "pipe" });
});
afterEach(() => {
  if (!path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error("Unsafe temporary cleanup");
  rmSync(directory, { recursive: true, force: true });
});
function environment() { return { ...process.env, DATABASE_URL: "file:" + databasePath, UPLOAD_DIR: path.join(directory, "uploads") }; }
function mapping() {
  const db = new Database(databasePath);
  const entries = (db.prepare("SELECT id, questions_json FROM practice_sets ORDER BY id").all() as { id: string; questions_json: string }[]).map((row) => ({
    id: row.id, questionsSha256: hash(row.questions_json), files: [{ sha256, totalPages: 2 }],
    questionDocuments: [{ documentIndex: 0, sha256, page: 1, endPage: 1 }],
    readingPassages: [{ id: "passage-1", label: "Passage 1", questionIds: ["q2"], documents: [{ sha256, label: "Original", page: 1, endPage: 1 }] }],
  }));
  db.close(); return { format: "ielts-studio-reading-passages", version: 1, sets: entries };
}
function run(pack = mapping(), dryRun = false) {
  writeFileSync(manifest, JSON.stringify(pack));
  return JSON.parse(execFileSync(process.execPath, [path.resolve("scripts/backfill-reading-passages.cjs"), manifest, ...(dryRun ? ["--dry-run"] : [])], { env: environment(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
}
function rows() {
  const db = new Database(databasePath);
  const result = { sets: db.prepare("SELECT * FROM practice_sets ORDER BY id").all() as Record<string, unknown>[], materials: db.prepare("SELECT * FROM source_materials").all(), attempts: db.prepare("SELECT * FROM practice_attempts").all() };
  db.close(); return result;
}

describe("reviewed reading metadata backfill", () => {
  it("dry-runs without changes, then changes only resource metadata and is idempotent", () => {
    const db = new Database(databasePath);
    db.prepare("INSERT INTO practice_attempts(set_id,kind,raw_score,total_questions,band_score,duration_seconds,answers_json,submitted_at) VALUES('user-reading-first','reading',0,1,0,30,'[]','2026-10-05')").run(); db.close();
    const before = rows(); const backupCount = readdirSync(path.join(directory, "backups")).length;
    expect(run(mapping(), true)).toMatchObject({ dryRun: true, updatedSets: 2 });
    expect(rows()).toEqual(before);
    expect(readdirSync(path.join(directory, "backups"))).toHaveLength(backupCount);
    const imported = run(); expect(imported.updatedSets).toBe(2); expect(existsSync(imported.safetyBackup)).toBe(true);
    const after = rows();
    expect(after.attempts).toEqual(before.attempts); expect(after.materials).toEqual(before.materials);
    after.sets.forEach((row, index) => { const original = before.sets[index]; expect({ ...row, resource_json: original.resource_json }).toEqual(original); });
    expect(run()).toMatchObject({ updatedSets: 0, unchangedSets: 2 });
    expect(rows()).toEqual(after);
    expect(readFileSync((after.materials[0] as { file_path: string }).file_path)).toEqual(pdfBytes);
  });
  it("rejects changed source or question hashes, invalid ranges and incomplete coverage before changing any row", () => {
    const before = rows();
    const changed = mapping(); changed.sets[0].questionsSha256 = "0".repeat(64);
    expect(() => run(changed)).toThrow(/Questions changed/);
    const beyond = mapping(); beyond.sets[0].readingPassages[0].documents[0].endPage = 3;
    expect(() => run(beyond)).toThrow(/Invalid reviewed PDF range/);
    const uncovered = mapping(); uncovered.sets[0].readingPassages[0].questionIds = [];
    expect(() => run(uncovered)).toThrow(/全部题目/);
    const db = new Database(databasePath); const file = (db.prepare("SELECT file_path FROM source_materials").get() as { file_path: string }).file_path; db.close();
    const originalMapping = mapping(); writeFileSync(file, Buffer.concat([pdfBytes, Buffer.from("changed")]));
    expect(() => run(originalMapping)).toThrow(/Original PDF changed/);
    expect(rows()).toEqual(before);
  });
  it("rolls back earlier metadata updates if a later row cannot be updated", () => {
    const before = rows();
    const db = new Database(databasePath); db.exec("CREATE TRIGGER reject_metadata BEFORE UPDATE OF resource_json ON practice_sets WHEN NEW.id='user-reading-second' BEGIN SELECT RAISE(ABORT,'synthetic metadata failure'); END"); db.close();
    expect(() => run()).toThrow(/synthetic metadata failure/);
    expect(rows()).toEqual(before);
  });
});
