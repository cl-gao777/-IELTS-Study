import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./store", () => ({ addFileMaterial: vi.fn() }));

import { extractMaterialText } from "./material-import";

const text = "Original import verification. Urban gardens support native insects.";
function fixture(extension: "pdf" | "docx") {
  const bytes = readFileSync(path.join(import.meta.dirname, "fixtures", `original-import.${extension}`));
  const type = extension === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return { bytes, file: new File([bytes], `original-import.${extension}`, { type }) };
}

describe("real local document extraction", () => {
  it("extracts the original compressed ReportLab PDF using a local Windows-compatible worker", async () => {
    const { bytes, file } = fixture("pdf");
    expect(await extractMaterialText(bytes, file)).toBe(text);
  });
  it("can parse the same PDF again after destroying its previous worker", async () => {
    const { bytes, file } = fixture("pdf");
    expect(await extractMaterialText(bytes, file)).toBe(text);
    expect(await extractMaterialText(bytes, file)).toBe(text);
  });
  it("extracts an original DOCX without passing it through the PDF parser", async () => {
    const { bytes, file } = fixture("docx");
    expect(await extractMaterialText(bytes, file)).toBe(text);
  });
  it("rejects a broken PDF instead of saving a false successful import", async () => {
    const bytes = Buffer.from("This is not a PDF.");
    await expect(extractMaterialText(bytes, new File([bytes], "invalid.pdf", { type: "application/pdf" }))).rejects.toThrow();
  });
});
