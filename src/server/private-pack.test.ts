import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
vi.mock("server-only", () => ({}));
import { migrate } from "./db";

let directory: string;
let databasePath: string;
let uploads: string;
let pdf: string;
const bytes = Buffer.from("%PDF-1.7\nSynthetic private import fixture.\n");
const sha256 = createHash("sha256").update(bytes).digest("hex");

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "ielts-private-import-"));
  databasePath = path.join(directory, "ists.db");
  uploads = path.join(directory, "uploads"); mkdirSync(uploads);
  pdf = path.join(directory, "source.pdf"); writeFileSync(pdf, bytes);
  const db = new Database(databasePath); migrate(db); db.close();
});
afterEach(() => {
  if (!path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error("Unsafe temporary cleanup");
  rmSync(directory, { recursive: true, force: true });
});
function set(id = "user-reading-fixture") {
  return {
    id, kind: "reading", title: "Synthetic reading", provider: "个人资料", copyright: "Synthetic test content",
    verifiedAt: "2026-10-05", collectionYear: 2021, durationMinutes: 20,
    documents: [
      { role: "questions", label: "题目", localPath: pdf, sha256, page: 1, content: "Synthetic source text" },
      { role: "answers", label: "答案", localPath: pdf, sha256, page: 2 },
    ],
    questions: [{ id: "q1", originalQuestionNumber: 1, kind: "short-answer", prompt: "Synthetic question", answers: ["sample"] }],
    readingPassages: [{ id: "passage-1", label: "Synthetic Passage", questionIds: ["q1"], documents: [{ documentIndex: 0, page: 1, endPage: 1 }] }],
  };
}
function run(sets: ReturnType<typeof set>[]) {
  const manifest = path.join(directory, "pack.json");
  writeFileSync(manifest, JSON.stringify({ format: "ielts-studio-private-pack", sets }));
  return JSON.parse(execFileSync(process.execPath, [path.resolve("scripts/import-private-pack.cjs"), manifest], {
    env: { ...process.env, DATABASE_URL: "file:" + databasePath, UPLOAD_DIR: uploads }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }));
}

describe("private PDF pack import", () => {
  it("copies one original for its question and answer views and preserves history on reimport", () => {
    expect(run([set()])).toMatchObject({ addedSets: 1, addedFiles: 1, questions: 1 });
    const db = new Database(databasePath);
    const row = db.prepare("SELECT resource_json FROM practice_sets WHERE id=?").get(set().id) as { resource_json: string };
    const resource = JSON.parse(row.resource_json);
    expect(resource.classification).toBe("user-supplied");
    expect(resource.sourceUrl).toBe(""); expect(resource.bandEstimateAllowed).toBe(false);
    expect(resource.questionDocuments[0].url).toBe(resource.answerDocuments[0].url);
    expect(resource.answerDocuments[0].page).toBe(2);
    expect(resource.readingPassages[0].documents[0]).toMatchObject({ url: resource.questionDocuments[0].url, page: 1, endPage: 1 });
    expect(resource.readingPassages[0].questionIds).toEqual(["q1"]);
    const material = db.prepare("SELECT file_path,content FROM source_materials").get() as { file_path: string; content: string };
    expect(readFileSync(material.file_path)).toEqual(bytes);
    expect(material.content).toContain("Synthetic source text");
    db.prepare("INSERT INTO practice_attempts(set_id,kind,raw_score,total_questions,band_score,duration_seconds,answers_json,submitted_at) VALUES(?,'reading',1,1,0,1,'[]','2026-10-05')").run(set().id);
    db.close();
    expect(run([set()])).toMatchObject({ addedSets: 0, addedFiles: 0 });
    const reopened = new Database(databasePath);
    expect(reopened.prepare("SELECT COUNT(*) AS n FROM practice_attempts").get()).toEqual({ n: 1 }); reopened.close();
    expect(readdirSync(uploads)).toHaveLength(1);
  });
  it("rejects changed source bytes before touching the database", () => {
    writeFileSync(pdf, Buffer.concat([bytes, Buffer.from("changed")]));
    expect(() => run([set()])).toThrow(/changed since review/);
    expect(readdirSync(uploads)).toHaveLength(0);
    const db = new Database(databasePath); expect(db.prepare("SELECT COUNT(*) AS n FROM practice_sets").get()).toEqual({ n: 0 }); db.close();
  });
  it("rejects answer-document references or incomplete Passage question coverage before importing", () => {
    const answerReference = set(); answerReference.readingPassages[0].documents[0].documentIndex = 1;
    expect(() => run([answerReference])).toThrow(/reviewed question document/);
    const exposed = set(); exposed.readingPassages[0].documents[0].endPage = 2;
    expect(() => run([exposed])).toThrow(/参考答案页/);
    const missing = set(); missing.readingPassages[0].questionIds = [];
    expect(() => run([missing])).toThrow(/全部题目/);
    const db = new Database(databasePath); expect(db.prepare("SELECT COUNT(*) AS n FROM practice_sets").get()).toEqual({ n: 0 }); db.close();
    expect(readdirSync(uploads)).toHaveLength(0);
  });
  it("refuses to silently replace answers for an installed paper", () => {
    run([set()]); const changed = set(); changed.questions[0].answers = ["different"];
    expect(() => run([changed])).toThrow(/refusing to replace learning history/);
    const db = new Database(databasePath);
    const row = db.prepare("SELECT questions_json FROM practice_sets").get() as { questions_json: string };
    expect(JSON.parse(row.questions_json)[0].answers).toEqual(["sample"]); db.close();
  });
  it("does not duplicate the same paper when it is renamed or listed twice", () => {
    expect(run([set(), set("user-reading-another-name")])).toMatchObject({ addedSets: 1, addedFiles: 1 });
    const renamed = set("user-reading-renamed");
    const anotherPath = path.join(directory, "renamed.pdf"); writeFileSync(anotherPath, bytes);
    renamed.documents.forEach((d) => { d.localPath = anotherPath; });
    expect(run([renamed])).toMatchObject({ addedSets: 0, addedFiles: 0 });
    const db = new Database(databasePath);
    expect(db.prepare("SELECT COUNT(*) AS n FROM practice_sets").get()).toEqual({ n: 1 }); db.close();
  });
  it("rolls back the entire batch and copied files when a later insertion fails", () => {
    const db = new Database(databasePath);
    db.exec("CREATE TRIGGER fail_second BEFORE INSERT ON practice_sets WHEN NEW.id='user-reading-second' BEGIN SELECT RAISE(ABORT,'synthetic insert failure'); END"); db.close();
    const second = set("user-reading-second"); second.questions[0].answers = ["another"];
    expect(() => run([set(), second])).toThrow(/synthetic insert failure/);
    const reopened = new Database(databasePath);
    expect(reopened.prepare("SELECT COUNT(*) AS n FROM practice_sets").get()).toEqual({ n: 0 });
    expect(reopened.prepare("SELECT COUNT(*) AS n FROM source_materials").get()).toEqual({ n: 0 }); reopened.close();
    expect(readdirSync(uploads)).toHaveLength(0);
  });
});
