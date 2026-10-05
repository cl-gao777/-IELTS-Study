"use client";

import { useState, type RefObject } from "react";
import { resourceLabel, type OfficialPracticeResource, type ReadingPassage } from "@/lib/official-resources";
import { ContinuousPdf } from "./continuous-pdf";
import { RevealDocuments } from "./official-paper";
import ui from "./page-ui.module.css";
import styles from "./practice.module.css";

export function ReadingPaper({ resource, passage, scrollRoot, onLayoutReady }: {
  resource: OfficialPracticeResource;
  passage: ReadingPassage;
  scrollRoot: RefObject<HTMLElement | null>;
  onLayoutReady: () => void;
}) {
  const [zooms, setZooms] = useState<Record<string, number>>({});
  const zoom = zooms[passage.id] || 100;
  function changeZoom(next: number) {
    const panel = scrollRoot.current;
    const panelTop = panel?.getBoundingClientRect().top || 0;
    const anchor = panel && [...panel.querySelectorAll<HTMLElement>("[data-pdf-page]")].find((element) => element.getBoundingClientRect().bottom > panelTop);
    const before = anchor?.getBoundingClientRect();
    const fraction = before ? Math.max(0, (panelTop - before.top) / before.height) : 0;
    const gap = before ? Math.max(0, before.top - panelTop) : 0;
    setZooms((current) => ({ ...current, [passage.id]: next }));
    requestAnimationFrame(() => {
      if (!panel || !anchor?.isConnected) return;
      const after = anchor.getBoundingClientRect();
      panel.scrollTop = after.top - panel.getBoundingClientRect().top + panel.scrollTop + fraction * after.height - gap;
    });
  }
  return <div className={styles.readingPaper} data-reading-passage={passage.id}>
    <div className={styles.readingPaperToolbar}>
      <h2 title={passage.label}>{passage.label}</h2>
      <label>缩放<select className={ui.select} value={zoom} aria-label="阅读材料缩放" onChange={(event) => changeZoom(Number(event.target.value))}>{[100, 125, 150, 200].map((value) => <option value={value} key={value}>{value === 100 ? "适应宽度" : value + "%"}</option>)}</select></label>
    </div>
    {resource.issues.map((issue) => <p className={ui.notice + " " + styles.readingIssue} key={issue}>{issue}</p>)}
    <ContinuousPdf key={passage.id} documents={passage.documents} headingLabel={passage.label} scrollRoot={scrollRoot} zoom={zoom} onLayoutReady={onLayoutReady} />
    <details className={styles.resourceDetails}>
      <summary>资料信息与原文件 · {resourceLabel(resource)}</summary>
      <p>{resource.provider}</p><p>{resource.copyright}</p>
      {resource.notes && <p className={styles.resourceNotes}>{resource.notes}</p>}
      {resource.originalFileName && <p>原文件：{resource.originalFileName}</p>}
      {resource.originalPath && <p className={styles.resourceNotes}>导入位置：{resource.originalPath}</p>}
      <p>资料核对日期：{resource.verifiedAt}</p>
      <div className={styles.libraryActions}>{resource.sourceUrl && <a className={styles.sourceLink} href={resource.sourceUrl} target="_blank" rel="noreferrer">资料来源 ↗</a>}{resource.licenseUrl && <a className={styles.sourceLink} href={resource.licenseUrl} target="_blank" rel="noreferrer">版权 / 使用条款 ↗</a>}{[...new Map(passage.documents.map((document) => [document.url, document])).values()].map((document) => <a className={styles.sourceLink} key={document.url} href={`${document.url}#page=${document.page}`} target="_blank" rel="noreferrer">打开完整原文件（含原卷附录） ↗</a>)}</div>
    </details>
    <RevealDocuments documents={resource.answerDocuments} label="参考答案 PDF" />
  </div>;
}
