import { describe, expect, it } from "vitest";
import { isOfficialResource, officialResourceSchema, parseOfficialResource, resourceLabel, validateReadingPassages } from "./official-resources";
import type { PracticeQuestion } from "./domain";

const base = {
  provider: "个人阅读资料", copyright: "保留原文件标识", verifiedAt: "2026-10-05",
  questionDocuments: [{ label: "原题 PDF", url: "/api/uploads/1" }],
};

describe("practice resource provenance", () => {
  it("supports private documents without fabricating publisher links", () => {
    const result = officialResourceSchema.parse({ ...base, sourceUrl: "", licenseUrl: "", classification: "user-supplied", collectionYear: 2021, originalFileName: "2021-01-01.pdf", questionDocuments: [{ ...base.questionDocuments[0], sourceUrl: "" }] });
    expect(result.sourceUrl).toBe("");
    expect(result.questionDocuments[0].sourceUrl).toBe("");
    expect(isOfficialResource(result)).toBe(false);
    expect(resourceLabel(result)).toBe("用户提供");
  });
  it("still requires the source and license for official documents", () => {
    expect(parseOfficialResource({ ...base, classification: "official-practice" })).toBeUndefined();
    expect(parseOfficialResource({ ...base, classification: "official-practice", sourceUrl: "https://ielts.org/sample", licenseUrl: "https://ielts.org/legal" })).toBeUndefined();
    const result = officialResourceSchema.parse({ ...base, classification: "official-practice", sourceUrl: "https://ielts.org/sample", licenseUrl: "https://ielts.org/legal", questionDocuments: [{ ...base.questionDocuments[0], sourceUrl: "https://ielts.org/paper.pdf" }] });
    expect(isOfficialResource(result)).toBe(true);
    expect(resourceLabel(result)).toBe("官方公开练习");
  });
  it("rejects active or nonlocal attachment links", () => {
    expect(parseOfficialResource({ ...base, classification: "user-supplied", sourceUrl: "javascript:alert(1)" })).toBeUndefined();
    expect(parseOfficialResource({ ...base, classification: "user-supplied", questionDocuments: [{ label: "PDF", url: "https://example.com/file.pdf" }] })).toBeUndefined();
  });
});

describe("reading Passage references", () => {
  const questions: PracticeQuestion[] = ["q2", "q3", "q4"].map((id) => ({ id, kind: "short-answer", prompt: id, answers: ["sample"], explanation: "" }));
  const documents = [{ label: "Original reading", url: "/api/uploads/1", page: 1, endPage: 4 }];
  const first = { id: "passage-1", label: "Passage 1", documents, questionIds: ["q2", "q3"] };
  const second = { id: "passage-2", label: "Passage 2", documents: [{ ...documents[0], page: 5, endPage: 8 }], questionIds: ["q4"] };
  function resource(readingPassages: unknown = [first, second]) {
    return officialResourceSchema.parse({ ...base, classification: "user-supplied", answerDocuments: [{ label: "Solutions", url: "/api/uploads/1", page: 9 }], readingPassages });
  }
  it("keeps older resources valid and supports partial numbering without inventing q1", () => {
    const older = officialResourceSchema.parse({ ...base, classification: "user-supplied" });
    expect(older.readingPassages).toBeUndefined();
    expect(() => validateReadingPassages({ kind: "reading", questions, resource: resource() })).not.toThrow();
    expect(() => validateReadingPassages({ kind: "reading", questions, resource: older })).not.toThrow();
  });
  it("rejects inverted ranges, duplicate Passage IDs, unrelated documents and exposed answers", () => {
    for (const passages of [
      [{ ...first, documents: [{ ...documents[0], page: 4, endPage: 3 }] }],
      [first, { ...second, id: first.id }],
      [{ ...first, documents: [{ ...documents[0], url: "/api/uploads/2" }] }],
      [{ ...first, documents: [{ ...documents[0], endPage: 9 }] }],
    ]) expect(() => resource(passages)).toThrow();
  });
  it("requires existing question IDs to be covered once, independently of displayed numbering", () => {
    for (const passages of [
      [{ ...first, questionIds: ["q2", "q3", "unknown"] }],
      [first, { ...second, questionIds: ["q3", "q4"] }],
      [first],
    ]) expect(() => validateReadingPassages({ kind: "reading", questions, resource: resource(passages) })).toThrow();
    expect(() => validateReadingPassages({ kind: "listening", questions, resource: resource() })).toThrow("只有阅读");
  });
  it("keeps an unordered answer group in one Passage", () => {
    const grouped = questions.map((question) => ({ ...question, answerGroup: "shared" }));
    expect(() => validateReadingPassages({ kind: "reading", questions: grouped, resource: resource() })).toThrow("不能跨阅读篇章");
  });
  it("supports one Passage with its text and questions in different original PDFs", () => {
    const combined = officialResourceSchema.parse({ ...base, classification: "user-supplied", questionDocuments: [...base.questionDocuments, { label: "题本", url: "/api/uploads/2" }], readingPassages: [{ ...first, documents: [...documents, { label: "题本", url: "/api/uploads/2", page: 4, endPage: 6 }], questionIds: questions.map((q) => q.id) }] });
    expect(() => validateReadingPassages({ kind: "reading", questions, resource: combined })).not.toThrow();
    expect(combined.readingPassages![0].documents).toHaveLength(2);
  });
});
