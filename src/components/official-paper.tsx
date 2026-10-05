"use client";

import { useEffect, useRef, useState } from "react";
import { isOfficialResource, resourceLabel, type OfficialDocument, type OfficialPracticeResource } from "@/lib/official-resources";
import { ListeningPlayer } from "./listening-player";
import ui from "./page-ui.module.css";
import styles from "./practice.module.css";

type AudioRange = { startSeconds?: number; endSeconds?: number };

export function OfficialPaper({ resource, listening, onRange }: { resource: OfficialPracticeResource; listening: boolean; onRange: (range: AudioRange) => void }) {
  const [trackIndex, setTrackIndex] = useState(0);
  const audioPanel = useRef<HTMLElement>(null);
  const track = resource.audioTracks[trackIndex];
  const official = isOfficialResource(resource);

  return <div className={styles.officialPaper}>
    <div className={styles.libraryMeta}><span className={ui.statusPill}>{resourceLabel(resource)}</span><span className={ui.pill}>{resource.provider}</span></div>
    <div><p className={styles.paperHint}>{resource.copyright}</p>{resource.sourceUrl && <a className={styles.sourceLink} href={resource.sourceUrl} target="_blank" rel="noreferrer">{official ? "官方出处" : "资料来源"} ↗</a>}</div>
    {resource.issues.map((issue) => <p className={ui.notice} key={issue}>{issue}</p>)}
    <details className={styles.resourceDetails}><summary>来源与使用说明</summary>
      {resource.notes && <p className={styles.resourceNotes}>{resource.notes}</p>}
      {resource.originalFileName && <p>原文件：{resource.originalFileName}</p>}
      {resource.originalPath && <p className={styles.resourceNotes}>导入位置：{resource.originalPath}</p>}
      <p>{official ? "来源" : "导入"}核对日期：{resource.verifiedAt}</p>
      <div className={styles.libraryActions}>{resource.sourceUrl && <a className={styles.sourceLink} href={resource.sourceUrl} target="_blank" rel="noreferrer">{official ? "官方出处" : "资料来源"} ↗</a>}{resource.licenseUrl && <a className={styles.sourceLink} href={resource.licenseUrl} target="_blank" rel="noreferrer">版权 / 使用条款 ↗</a>}</div>
    </details>

    {listening && track && <section ref={audioPanel} className={styles.officialAudio} aria-label="听力音频">
      <label className={ui.field}>音频 / Part<select className={ui.select} value={trackIndex} onChange={(event) => { audioPanel.current?.querySelector("audio")?.pause(); setTrackIndex(Number(event.target.value)); onRange({}); }}>{resource.audioTracks.map((item, index) => <option value={index} key={item.url + index}>{item.label}</option>)}</select></label>
      <details open><summary>播放与 AB 循环 · {track.label}</summary><ListeningPlayer key={trackIndex + ":" + track.url} audioUrl={track.url} transcript="" onRange={onRange} /></details>
      {track.sourceUrl && <a className={styles.sourceLink} href={track.sourceUrl} target="_blank" rel="noreferrer">音频{official ? "官方出处" : "来源"} ↗</a>}
    </section>}
    {listening && !track && <p className={ui.notice}>这份资料未附本地音频，请参阅来源说明。</p>}

    <DocumentViewer documents={resource.questionDocuments} label="试卷 PDF" />
    <p className={styles.paperHint}>题目与选项以原版 PDF 为准；在右侧按对应题号作答。学习笔记在下方自动保存。</p>
    <RevealDocuments documents={resource.answerDocuments} label="答案 PDF" />
    <RevealDocuments documents={resource.transcriptDocuments} label="Transcript PDF" />
  </div>;
}

function RevealDocuments({ documents, label }: { documents: OfficialDocument[]; label: string }) {
  const [open, setOpen] = useState(false);
  if (!documents.length) return null;
  return <details className={styles.resourceDetails} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>查看 {label}（建议先完成作答）</summary>
    {open && <DocumentViewer documents={documents} label={label} />}
  </details>;
}

function DocumentViewer({ documents, label }: { documents: OfficialDocument[]; label: string }) {
  const [index, setIndex] = useState(0);
  const document = documents[index];
  const [pageInput, setPageInput] = useState(String(document.page || 1));
  const [page, setPage] = useState(document.page || 1);
  const [preview, setPreview] = useState<{ image: string; text: string; page: number; total: number; source: string } | null>(null);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(100);
  useEffect(() => {
    const controller = new AbortController();
    fetch(document.url + "/preview?page=" + page, { signal: controller.signal }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "预览失败");
      setPreview({ ...result, source: document.url }); setError("");
    }).catch((failure) => { if (failure.name !== "AbortError") { setPreview(null); setError(failure.message); } });
    return () => controller.abort();
  }, [document.url, page]);
  const loaded = preview?.source === document.url && preview?.page === page && !error;
  const url = `${document.url}#page=${page}`;
  function goToPage() {
    const next = Number(pageInput);
    if (Number.isInteger(next) && next > 0 && next <= 10000) setPage(next);
    else setPageInput(String(page));
  }

  return <section className={styles.documentViewer} aria-label={label}>
    <div className={styles.documentToolbar}>
      <label className={ui.field}>{label}<select className={ui.select} value={index} onChange={(event) => { const next = Number(event.target.value); const firstPage = documents[next].page || 1; setIndex(next); setPage(firstPage); setPageInput(String(firstPage)); }}>{documents.map((item, itemIndex) => <option value={itemIndex} key={item.url + itemIndex}>{item.label}</option>)}</select></label>
      <div className={styles.documentPage}><label className={ui.field}>PDF 页码<input className={ui.input} type="text" inputMode="numeric" maxLength={5} aria-label={label + "页码"} value={pageInput} onChange={(event) => setPageInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); goToPage(); } }} /></label><button className={ui.buttonGhost} type="button" onClick={goToPage}>跳转</button></div>
    </div>
    <div className={styles.documentLinks}><a className={styles.sourceLink} href={url} target="_blank" rel="noreferrer">在新窗口打开 PDF ↗</a>{document.sourceUrl && <a className={styles.sourceLink} href={document.sourceUrl} target="_blank" rel="noreferrer">文件来源 ↗</a>}</div>
    <div className={styles.pageControls}><button className={ui.buttonGhost} type="button" disabled={page <= 1} onClick={() => { setPage(page - 1); setPageInput(String(page - 1)); }}>上一页</button><span>{page} / {preview?.total || "…"}</span><button className={ui.buttonGhost} type="button" disabled={!preview || page >= preview.total} onClick={() => { setPage(page + 1); setPageInput(String(page + 1)); }}>下一页</button><label>缩放<select className={ui.select} value={zoom} onChange={(event) => setZoom(Number(event.target.value))}>{[100, 125, 150, 200].map((value) => <option value={value} key={value}>{value}%</option>)}</select></label></div>
    <div className={styles.pdfFrame} aria-busy={!loaded && !error}>
      {error ? <p role="alert">{error}</p> : loaded ? <>{/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.pdfPage} style={{ width: zoom + "%" }} src={preview.image} alt={`${document.label} · 第 ${page} 页，共 ${preview.total} 页`} />
      </> : <p role="status">正在加载原版 PDF 第 {page} 页…</p>}
    </div>
    {loaded && preview.text && <details className={styles.resourceDetails}><summary>本页可选文字 · 用于词汇摘录</summary><div className={styles.pdfText}>{preview.text}</div></details>}
    <p className={styles.paperHint}>页码指 PDF 文件页码；原文件保留完整排版和版权信息。</p>
  </section>;
}
