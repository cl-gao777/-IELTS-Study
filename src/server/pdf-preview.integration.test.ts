import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { createPdfPreviewService } from "./pdf-preview";

describe("real local PDF preview", () => {
  it("queries physical dimensions and renders a real original PDF with matching PNG pixels", async () => {
    const file = path.join(import.meta.dirname, "fixtures", "original-import.pdf");
    const service = createPdfPreviewService();
    const metadata = await service.metadata(file);
    expect(metadata.total).toBe(1);
    expect(metadata.pages).toHaveLength(1);
    expect(metadata.pages[0]).toMatchObject({ page: 1, width: expect.any(Number), height: expect.any(Number) });

    const preview = await service.page(file, 1);
    const png = Buffer.from(preview.image.slice("data:image/png;base64,".length), "base64");
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(preview.width).toBe(png.readUInt32BE(16));
    expect(preview.height).toBe(png.readUInt32BE(20));
    expect(preview.width).toBe(1200);
    expect(preview.text).toContain("Urban gardens support native insects.");
    const extracted = await service.text(file, [1, 1]);
    expect(extracted).toHaveLength(1);
    expect(extracted[0]).toMatchObject({ page: 1, text: expect.stringContaining("Urban gardens support native insects.") });
    expect(preview.height / preview.width).toBeCloseTo(metadata.pages[0].height / metadata.pages[0].width, 2);
    await expect(service.page(file, 2)).rejects.toMatchObject({ status: 400 });
    await expect(service.text(file, [2])).rejects.toMatchObject({ status: 400 });
  });
});
