import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
vi.mock("server-only", () => ({}));
import { migrate } from "./db";

let directory: string;
let databasePath: string;
beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "ielts-official-passage-"));
  databasePath = path.join(directory, "ists.db");
  const db = new Database(databasePath); migrate(db); db.close();
});
afterEach(() => {
  if (!path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error("Unsafe temporary cleanup");
  rmSync(directory, { recursive: true, force: true });
});
function set() {
  const documents = ["text", "questions", "solutions"].map((name, index) => {
    const bytes = Buffer.from("%PDF-1.7\nSynthetic " + name + " fixture.\n");
    const localPath = path.join(directory, name + ".pdf"); writeFileSync(localPath, bytes);
    return { role: index === 2 ? "answers" : "questions", label: name, localPath, page: 1,
      sourceUrl: "https://ielts.org/synthetic-" + name + ".pdf", sha256: createHash("sha256").update(bytes).digest("hex") };
  });
  return {
    id: "official-reading-synthetic", kind: "reading", title: "Synthetic split booklets", provider: "IELTS fixture",
    classification: "official-practice", copyright: "Synthetic fixture only", sourceUrl: "https://ielts.org/synthetic",
    licenseUrl: "https://ielts.org/legal", verifiedAt: "2026-10-05", durationMinutes: 20, documents,
    questions: [1, 2].map((number) => ({ id: "q" + number, originalQuestionNumber: number, kind: "short-answer", prompt: "Synthetic", answers: ["sample"] })),
    readingPassages: [1, 2].map((number) => ({ id: "passage-" + number, label: "Passage " + number, questionIds: ["q" + number], documents: [
      { documentIndex: 0, page: number, endPage: number }, { documentIndex: 1, page: number, endPage: number },
    ] })),
  };
}
function run(entry: ReturnType<typeof set>) {
  const manifest = path.join(directory, "pack.json"); writeFileSync(manifest, JSON.stringify({ format: "ielts-studio-official-pack", sets: [entry] }));
  return JSON.parse(execFileSync(process.execPath, [path.resolve("scripts/import-official-pack.cjs"), manifest], { env: { ...process.env, DATABASE_URL: "file:" + databasePath, UPLOAD_DIR: path.join(directory, "uploads") }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
}
describe("official split-booklet Passage import", () => {
  it("groups the text and questions from different original PDFs while retaining separate solutions", () => {
    const entry = set(); expect(run(entry).addedFiles).toBe(3);
    const db = new Database(databasePath);
    const resource = JSON.parse((db.prepare("SELECT resource_json FROM practice_sets").get() as { resource_json: string }).resource_json);
    expect(resource.readingPassages.map((passage: { questionIds: string[] }) => passage.questionIds)).toEqual([["q1"], ["q2"]]);
    expect(resource.readingPassages[0].documents.map((document: { url: string }) => document.url)).toEqual(resource.questionDocuments.map((document: { url: string }) => document.url));
    expect(resource.answerDocuments[0].url).not.toBe(resource.questionDocuments[0].url);
    const files = db.prepare("SELECT file_name,file_path FROM source_materials").all() as { file_name: string; file_path: string }[];
    files.forEach((file) => expect(readFileSync(file.file_path)).toEqual(readFileSync(path.join(directory, file.file_name))));
    expect(resource.readingPassages[1].documents[0]).toMatchObject({ page: 2, endPage: 2, sourceUrl: entry.documents[0].sourceUrl });
    db.close();
  });
  it("rejects a reference to the answer booklet before inserting any data", () => {
    const entry = set(); entry.readingPassages[0].documents[0].documentIndex = 2;
    expect(() => run(entry)).toThrow(/reviewed question document/);
    const db = new Database(databasePath); expect(db.prepare("SELECT COUNT(*) AS n FROM practice_sets").get()).toEqual({ n: 0 }); db.close();
  });
});
