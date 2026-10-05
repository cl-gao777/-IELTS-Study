"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { OfficialDocument } from "@/lib/official-resources";
import { BoundedLruCache, expandPdfPageRanges, pdfPageWindow, PdfPageRequestWindow, type PdfPageLoadState, type PdfPageLocation } from "@/lib/pdf-page-window";
import ui from "./page-ui.module.css";
import styles from "./continuous-pdf.module.css";

type ReadingDocument = OfficialDocument & { page: number; endPage: number };
type PageSize = { page: number; width: number; height: number };
type PdfMetadata = { total: number; pages: PageSize[] };
type PagePreview = PageSize & { image: string; text: string; total: number };
type SizedPage = PdfPageLocation & PageSize & { total: number; cacheKey: string };

export type ContinuousPdfProps = {
  documents: ReadingDocument[];
  headingLabel?: string;
  scrollRoot: RefObject<HTMLElement | null>;
  zoom?: number;
  onLayoutReady?: () => void;
};

const metadataCache = new BoundedLruCache<string, PdfMetadata>(16, 2 * 1024 * 1024, (metadata) => metadata.pages.length * 64);
const pageCache = new BoundedLruCache<string, PagePreview>(12, 24 * 1024 * 1024, (preview) => (preview.image.length + preview.text.length) * 2);
const expandedTextCache = new BoundedLruCache<string, string>(24, 512 * 1024, (text) => text.length * 2);
const sourceKey = (document: Pick<OfficialDocument, "url" | "sha256">) => document.url + "|" + (document.sha256 ?? "");
const validDimension = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

async function fetchPreview(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal, cache: "no-store" });
  const result: unknown = await response.json();
  if (!response.ok) {
    const failure = result && typeof result === "object" && "error" in result ? result.error : null;
    throw new Error(typeof failure === "string" ? failure : "PDF 预览加载失败，请重试");
  }
  return result;
}

function parseMetadata(value: unknown): PdfMetadata {
  const result = value as Partial<PdfMetadata> | null;
  if (!result || !Number.isInteger(result.total) || !result.total || result.total > 10000 || !Array.isArray(result.pages) || result.pages.length !== result.total) {
    throw new Error("PDF 页数信息不完整，请重试");
  }
  const pages = result.pages;
  if (pages.some((page) => !page || !Number.isInteger(page.page) || page.page < 1 || page.page > result.total! || !validDimension(page.width) || !validDimension(page.height)) || new Set(pages.map((page) => page.page)).size !== result.total) {
    throw new Error("PDF 页面尺寸信息不完整，请重试");
  }
  return { total: result.total, pages };
}

function parsePagePreview(value: unknown, page: SizedPage): PagePreview {
  const result = value as Partial<PagePreview> | null;
  if (!result || result.page !== page.page || result.total !== page.total || !validDimension(result.width) || !validDimension(result.height) || typeof result.image !== "string" || !/^data:image\/(?:png|jpeg|webp);base64,/.test(result.image)) {
    throw new Error("PDF 页面预览不完整，请重试本页");
  }
  return { page: result.page, total: result.total, width: result.width, height: result.height, image: result.image, text: typeof result.text === "string" ? result.text : "" };
}

function usePdfMetadata(documents: ReadingDocument[]) {
  const [metadata, setMetadata] = useState<Map<string, PdfMetadata> | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const sources = [...new Map(documents.map((document) => [document.url, document])).values()];
    const loaded = new Map<string, PdfMetadata>();
    const failures: string[] = [];
    let cursor = 0;
    async function worker() {
      while (cursor < sources.length && !controller.signal.aborted) {
        const document = sources[cursor++];
        try {
          const key = sourceKey(document);
          const info = metadataCache.get(key) ?? parseMetadata(await fetchPreview(document.url + "/preview?metadata=1", controller.signal));
          if (documents.some((range) => range.url === document.url && range.endPage > info.total)) throw new Error("本篇的 PDF 页范围超出了原文件页数");
          metadataCache.put(key, info);
          loaded.set(document.url, info);
        } catch (failure) {
          if (!controller.signal.aborted) failures.push(document.label + "：" + (failure instanceof Error ? failure.message : "无法读取页数"));
        }
      }
    }
    void Promise.all([worker(), worker()]).then(() => {
      if (controller.signal.aborted) return;
      if (failures.length) setError(failures.join("；"));
      else { setError(""); setMetadata(loaded); }
    });
    return () => controller.abort();
  }, [documents, attempt]);
  return { metadata, error, retry: () => { setError(""); setAttempt((value) => value + 1); } };
}

function useVisiblePages(pageCount: number, scrollRoot: RefObject<HTMLElement | null>) {
  const nodes = useRef(new Map<number, HTMLElement>());
  const [visible, setVisible] = useState<number[]>([]);
  const registerPage = useCallback((index: number, node: HTMLElement | null) => {
    if (node) nodes.current.set(index, node);
    else nodes.current.delete(index);
  }, []);
  useEffect(() => {
    if (!pageCount) return;
    const root = scrollRoot.current;
    let frame = 0;
    function measure() {
      frame = 0;
      const bounds = root?.getBoundingClientRect();
      const top = Math.max(0, bounds?.top ?? 0);
      const bottom = Math.min(window.innerHeight, bounds?.bottom ?? window.innerHeight);
      const next: number[] = [];
      for (const [index, node] of nodes.current) {
        const page = node.getBoundingClientRect();
        if (page.bottom > top && page.top < bottom) next.push(index);
      }
      setVisible((previous) => previous.length === next.length && previous.every((index, position) => index === next[position]) ? previous : next);
    }
    function scheduleMeasure() { if (!frame) frame = requestAnimationFrame(measure); }
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(scheduleMeasure, { root, threshold: 0 });
    for (const node of nodes.current.values()) observer?.observe(node);
    root?.addEventListener("scroll", scheduleMeasure, { passive: true });
    window.addEventListener("scroll", scheduleMeasure, { passive: true });
    window.addEventListener("resize", scheduleMeasure);
    scheduleMeasure();
    return () => {
      observer?.disconnect();
      root?.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
      cancelAnimationFrame(frame);
    };
  }, [pageCount, scrollRoot]);
  return { visible, registerPage };
}

function usePagePreviews(pages: SizedPage[], activeIndexes: number[]) {
  const loader = useRef<PdfPageRequestWindow<PagePreview> | null>(null);
  const [states, setStates] = useState<ReadonlyMap<string, PdfPageLoadState<PagePreview>>>(new Map());
  useEffect(() => {
    const lookup = new Map(pages.map((page) => [page.cacheKey, page]));
    const session = new PdfPageRequestWindow<PagePreview>({
      cache: pageCache,
      load: async (key, signal) => {
        const page = lookup.get(key)!;
        return parsePagePreview(await fetchPreview(page.url + "/preview?page=" + page.page, signal), page);
      },
      onChange: setStates,
    });
    loader.current = session;
    return () => { session.dispose(); loader.current = null; };
  }, [pages]);
  useEffect(() => { loader.current?.update(activeIndexes.map((index) => pages[index].cacheKey)); }, [pages, activeIndexes]);
  return {
    states,
    retry: (key: string) => loader.current?.retry(key),
    imageFailed: (key: string) => loader.current?.fail(key, "本页图片显示失败，请重试本页"),
  };
}

export function ContinuousPdf(props: ContinuousPdfProps) {
  // The key also cancels an old source session when ranges change without a Passage remount.
  return <PdfDocumentSession key={JSON.stringify(props.documents)} {...props} />;
}

function PdfDocumentSession({ documents, headingLabel, scrollRoot, zoom = 100, onLayoutReady }: ContinuousPdfProps) {
  const [ranges] = useState(() => documents);
  const layoutReady = useRef(onLayoutReady);
  useLayoutEffect(() => { layoutReady.current = onLayoutReady; }, [onLayoutReady]);
  const { metadata, error, retry } = usePdfMetadata(ranges);
  const pages = useMemo(() => {
    if (!metadata) return [];
    const sizes = new Map([...metadata.entries()].map(([url, info]) => [url, new Map(info.pages.map((page) => [page.page, page]))]));
    return expandPdfPageRanges(ranges).map((page): SizedPage => ({
      ...page, ...sizes.get(page.url)!.get(page.page)!, total: metadata.get(page.url)!.total,
      cacheKey: sourceKey(page) + "#page=" + page.page,
    }));
  }, [metadata, ranges]);
  const { visible, registerPage } = useVisiblePages(pages.length, scrollRoot);
  const activeIndexes = useMemo(() => pdfPageWindow(visible, pages.length), [visible, pages.length]);
  const active = new Set(activeIndexes);
  const { states, retry: retryPage, imageFailed } = usePagePreviews(pages, activeIndexes);
  useLayoutEffect(() => {
    if (!metadata) return;
    // All physical-page placeholders are now committed; images never change their height.
    const frame = requestAnimationFrame(() => layoutReady.current?.());
    return () => cancelAnimationFrame(frame);
  }, [metadata]);
  const safeZoom = Number.isFinite(zoom) ? Math.max(50, Math.min(300, zoom)) : 100;
  const parentHeading = headingLabel?.trim();

  if (!ranges.length) return <p className={styles.message}>本篇暂未关联 PDF。</p>;
  if (error) return <div className={styles.message}><p role="alert">{error}</p><button className={ui.buttonGhost} type="button" onClick={retry}>重新加载 PDF 信息</button></div>;
  if (!metadata) return <p className={styles.message} role="status">正在准备连续阅读页面…</p>;

  return <section className={styles.viewer} aria-label="当前篇阅读材料和题目" data-continuous-pdf>
    <div className={styles.pageStrip} style={{ width: safeZoom + "%" }}>
      {pages.map((page, index) => <div key={page.key}>
        {(index === 0 || pages[index - 1].documentIndex !== page.documentIndex) && <div className={styles.sourceHeading}>{(!parentHeading || page.label.trim() !== parentHeading) && <h3>{page.label}</h3>}<span>PDF 第 {ranges[page.documentIndex].page}–{ranges[page.documentIndex].endPage} 页</span></div>}
        <PdfPage page={page} active={active.has(index)} state={states.get(page.cacheKey)} register={(node) => registerPage(index, node)} onRetry={() => retryPage(page.cacheKey)} onImageError={() => imageFailed(page.cacheKey)} />
      </div>)}
    </div>
  </section>;
}

function PdfPage({ page, active, state, register, onRetry, onImageError }: {
  page: SizedPage;
  active: boolean;
  state?: PdfPageLoadState<PagePreview>;
  register: (node: HTMLElement | null) => void;
  onRetry: () => void;
  onImageError: () => void;
}) {
  const preview = active && state?.status === "ready" ? state.value : null;
  // An explicitly expanded text excerpt stays open while its distant image is unloaded.
  const [openText, setOpenText] = useState<string | null>(() => expandedTextCache.peek(page.cacheKey) ?? null);
  return <figure ref={register} className={styles.page} data-pdf-page={page.page} data-pdf-page-key={page.key} data-pdf-source={page.url} data-pdf-active={active}>
    <figcaption className={styles.pageCaption}>PDF 第 {page.page} 页 <span>/ {page.total}</span></figcaption>
    <div className={styles.sheet} style={{ aspectRatio: page.width + " / " + page.height }} aria-busy={active && (!state || state.status === "loading")}>
      {preview ? <>{/* Local server-rendered pixels preserve the supplied PDF layout. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.pageImage} src={preview.image} alt={`${page.label} · PDF 第 ${page.page} 页，共 ${page.total} 页`} width={preview.width} height={preview.height} decoding="async" onError={onImageError} data-pdf-image />
      </> : <div className={styles.pagePlaceholder}>
        {active && state?.status === "error" ? <><p role="alert">{state.error}</p><button className={ui.buttonGhost} type="button" onClick={onRetry}>重试第 {page.page} 页</button></> : <p role={active ? "status" : undefined}>{active ? `正在加载 PDF 第 ${page.page} 页…` : `PDF 第 ${page.page} 页`}</p>}
      </div>}
    </div>
    <details className={styles.selectableText} open={openText !== null} onToggle={(event) => {
      const text = event.currentTarget.open ? preview?.text || openText || "本页未提取到文字，请参阅 PDF 原页。" : null;
      if (text === null) expandedTextCache.delete(page.cacheKey);
      else expandedTextCache.put(page.cacheKey, text);
      setOpenText(text);
    }}>
      <summary aria-disabled={!preview && openText === null} onClick={(event) => { if (!preview && openText === null) event.preventDefault(); }}>本页可选文字 · 用于词汇摘录</summary>
      <div className={styles.extractedText}>{openText ?? preview?.text ?? ""}</div>
    </details>
  </figure>;
}
