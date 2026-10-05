import { describe, expect, it } from "vitest";
import { isOfficialResource, officialResourceSchema, parseOfficialResource, resourceLabel } from "./official-resources";

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
