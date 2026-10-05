import { describe, expect, it } from "vitest";
import { BoundedLruCache, expandPdfPageRanges, PdfPageRequestWindow, pdfPageWindow } from "./pdf-page-window";

const flush = async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); };

describe("continuous PDF page window", () => {
  it("uses inclusive physical page ranges and deduplicates overlapping sources in supplied order", () => {
    const result = expandPdfPageRanges([
      { label: "原文", url: "/api/uploads/1", page: 2, endPage: 4 },
      { label: "题目", url: "/api/uploads/1", page: 4, endPage: 5 },
      { label: "补充题目", url: "/api/uploads/2", page: 1, endPage: 2 },
    ]);
    expect(result.map((page) => page.key)).toEqual([
      "/api/uploads/1#page=2", "/api/uploads/1#page=3", "/api/uploads/1#page=4", "/api/uploads/1#page=5", "/api/uploads/2#page=1", "/api/uploads/2#page=2",
    ]);
    expect(result[2].label).toBe("原文");
    expect(result[3].documentIndex).toBe(1);
    expect(() => expandPdfPageRanges([{ label: "PDF", url: "/api/uploads/1", page: 3, endPage: 2 }])).toThrow("页范围");
  });

  it("prioritizes visible pages and includes exactly two neighbours at document boundaries", () => {
    expect(pdfPageWindow([4, 5], 10)).toEqual([4, 5, 3, 6, 2, 7]);
    expect(pdfPageWindow([0], 10)).toEqual([0, 1, 2]);
    expect(pdfPageWindow([9], 10)).toEqual([9, 8, 7]);
    expect(pdfPageWindow([], 2)).toEqual([0, 1]);
    expect(pdfPageWindow([0, 9, 9, -1, 100], 10)).toEqual([0, 9, 1, 8, 2, 7]);
    expect(pdfPageWindow([], 0)).toEqual([]);
  });

  it("bounds cached responses by both count and memory, retaining recently viewed pages", () => {
    const cache = new BoundedLruCache<string, string>(2, 8, (value) => value.length);
    cache.put("a", "aaa"); cache.put("b", "bbb");
    expect(cache.get("a")).toBe("aaa");
    cache.put("c", "ccc");
    expect(cache.get("b")).toBeUndefined();
    cache.put("d", "123456");
    expect(cache.size).toBe(1);
    expect(cache.weight).toBe(6);
    cache.put("large", "123456789");
    expect(cache.get("large")).toBeUndefined();
  });

  it("limits requests to two, cancels pages left behind, and reuses completed responses", async () => {
    const cache = new BoundedLruCache<string, string>(4, 100, (value) => value.length);
    const requests: { key: string; signal: AbortSignal; resolve: (value: string) => void }[] = [];
    let active = 0, maximum = 0;
    const window = new PdfPageRequestWindow({
      cache,
      load: (key, signal) => new Promise<string>((resolve, reject) => {
        active += 1; maximum = Math.max(maximum, active);
        signal.addEventListener("abort", () => { active -= 1; reject(new DOMException("Aborted", "AbortError")); }, { once: true });
        requests.push({ key, signal, resolve: (value) => { active -= 1; resolve(value); } });
      }),
      onChange: () => {},
    });
    window.update(["visible", "next", "buffer"]);
    await flush();
    expect(requests.map((request) => request.key)).toEqual(["visible", "next"]);
    requests[0].resolve("original page"); await flush();
    expect(requests[2].key).toBe("buffer");
    window.update(["far"]); await flush();
    expect(requests[1].signal.aborted).toBe(true);
    expect(requests[2].signal.aborted).toBe(true);
    expect(requests[3].key).toBe("far");
    requests[3].resolve("far page"); await flush();
    window.update(["visible"]); await flush();
    expect(requests.length).toBe(4);
    expect(maximum).toBe(2);
    window.dispose();
  });

  it("retries a failed page without refetching its successful neighbour and ignores disposed work", async () => {
    const requests: string[] = [];
    let fail = true;
    let latest = new Map<string, unknown>();
    const window = new PdfPageRequestWindow({
      cache: new BoundedLruCache<string, string>(4, 100, (value) => value.length),
      load: async (key) => { requests.push(key); if (key === "bad" && fail) throw new Error("单页失败"); return key; },
      onChange: (states) => { latest = new Map(states); },
    });
    window.update(["good", "bad"]); await flush();
    expect(latest.get("bad")).toEqual({ status: "error", error: "单页失败" });
    fail = false; window.retry("bad"); await flush();
    expect(requests).toEqual(["good", "bad", "bad"]);
    expect(latest.get("bad")).toEqual({ status: "ready", value: "bad" });
    window.update(["new"]); window.dispose(); await flush();
    expect(latest.has("new")).toBe(false);
  });
});
