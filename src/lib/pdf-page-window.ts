export type PdfPageRange = { label: string; url: string; page: number; endPage: number; sha256?: string };
export type PdfPageLocation = { key: string; url: string; label: string; page: number; documentIndex: number; sha256?: string };

/** Keep the supplied source order, and show an overlapping physical PDF page only once. */
export function expandPdfPageRanges(documents: readonly PdfPageRange[]): PdfPageLocation[] {
  const seen = new Set<string>();
  const pages: PdfPageLocation[] = [];
  documents.forEach((document, documentIndex) => {
    if (!Number.isInteger(document.page) || !Number.isInteger(document.endPage) || document.page < 1 || document.endPage < document.page || document.endPage > 10000) {
      throw new Error("PDF 页范围无效");
    }
    for (let page = document.page; page <= document.endPage; page += 1) {
      const key = document.url + "#page=" + page;
      if (seen.has(key)) continue;
      seen.add(key);
      pages.push({ key, url: document.url, label: document.label, page, documentIndex, sha256: document.sha256 });
    }
  });
  return pages;
}

/** Visible pages first, followed by the nearest two neighbours on either side. */
export function pdfPageWindow(visibleIndexes: readonly number[], pageCount: number, overscan = 2): number[] {
  if (pageCount < 1) return [];
  const visible = [...new Set(visibleIndexes.filter((index) => Number.isInteger(index) && index >= 0 && index < pageCount))];
  if (!visible.length) visible.push(0);
  const distance = new Map<number, number>();
  for (const index of visible) {
    for (let next = Math.max(0, index - overscan); next <= Math.min(pageCount - 1, index + overscan); next += 1) {
      distance.set(next, Math.min(distance.get(next) ?? Infinity, Math.abs(next - index)));
    }
  }
  return [...distance.keys()].sort((left, right) => distance.get(left)! - distance.get(right)! || left - right);
}

export class BoundedLruCache<Key, Value> {
  private entries = new Map<Key, { value: Value; weight: number }>();
  private currentWeight = 0;

  constructor(private maxEntries: number, private maxWeight: number, private weigh: (value: Value) => number) {}

  get size() { return this.entries.size; }
  get weight() { return this.currentWeight; }

  peek(key: Key): Value | undefined { return this.entries.get(key)?.value; }

  get(key: Key): Value | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  put(key: Key, value: Value): void {
    this.delete(key);
    const weight = this.weigh(value);
    if (weight > this.maxWeight) return;
    this.entries.set(key, { value, weight });
    this.currentWeight += weight;
    while (this.entries.size > this.maxEntries || this.currentWeight > this.maxWeight) {
      this.delete(this.entries.keys().next().value!);
    }
  }

  delete(key: Key): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.currentWeight -= entry.weight;
    this.entries.delete(key);
  }
}

export type PdfPageLoadState<Value> = { status: "loading" } | { status: "ready"; value: Value } | { status: "error"; error: string };

/** A moving request window cancels old work and never starts more than two page requests. */
export class PdfPageRequestWindow<Value> {
  private desired: string[] = [];
  private states = new Map<string, PdfPageLoadState<Value>>();
  private pending = new Map<string, AbortController>();
  private disposed = false;
  private notificationPending = false;

  constructor(private options: {
    cache: BoundedLruCache<string, Value>;
    load: (key: string, signal: AbortSignal) => Promise<Value>;
    onChange: (states: ReadonlyMap<string, PdfPageLoadState<Value>>) => void;
  }) {}

  update(keys: readonly string[]): void {
    if (this.disposed) return;
    this.desired = [...new Set(keys)];
    const wanted = new Set(this.desired);
    for (const key of this.states.keys()) if (!wanted.has(key)) this.states.delete(key);
    for (const [key, controller] of this.pending) if (!wanted.has(key)) controller.abort();
    for (const key of this.desired) {
      if (this.states.has(key)) continue;
      const cached = this.options.cache.get(key);
      this.states.set(key, cached === undefined ? { status: "loading" } : { status: "ready", value: cached });
    }
    this.notify();
    this.pump();
  }

  retry(key: string): void {
    if (this.disposed || !this.desired.includes(key)) return;
    this.options.cache.delete(key);
    this.states.set(key, { status: "loading" });
    this.pending.get(key)?.abort();
    this.notify();
    this.pump();
  }

  fail(key: string, error: string): void {
    if (this.disposed || !this.desired.includes(key)) return;
    this.options.cache.delete(key);
    this.pending.get(key)?.abort();
    this.states.set(key, { status: "error", error });
    this.notify();
  }

  dispose(): void {
    this.disposed = true;
    for (const controller of this.pending.values()) controller.abort();
    this.states.clear();
  }

  private pump(): void {
    if (this.disposed) return;
    for (const key of this.desired) {
      if (this.pending.size >= 2) break;
      if (this.pending.has(key) || this.states.get(key)?.status !== "loading") continue;
      const controller = new AbortController();
      this.pending.set(key, controller);
      Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
        return this.options.load(key, controller.signal);
      }).then((value) => {
        if (this.disposed || controller.signal.aborted || !this.desired.includes(key)) return;
        this.options.cache.put(key, value);
        this.states.set(key, { status: "ready", value });
        this.notify();
      }).catch((failure: unknown) => {
        if (this.disposed || controller.signal.aborted || !this.desired.includes(key)) return;
        this.states.set(key, { status: "error", error: failure instanceof Error ? failure.message : "PDF 页面加载失败" });
        this.notify();
      }).finally(() => {
        this.pending.delete(key);
        this.pump();
      });
    }
  }

  private notify(): void {
    if (this.notificationPending) return;
    this.notificationPending = true;
    queueMicrotask(() => {
      this.notificationPending = false;
      if (!this.disposed) this.options.onChange(new Map(this.states));
    });
  }
}
