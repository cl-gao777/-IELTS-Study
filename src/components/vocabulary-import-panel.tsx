"use client";

import { useRef, useState, type FormEvent } from "react";
import type { VocabularyImportConfirmation, VocabularyImportPreview } from "@/lib/vocabulary-import";
import ui from "./page-ui.module.css";
import styles from "./vocabulary.module.css";

const statusLabels = { new: "新增", existing: "词库已有", duplicate: "文件重复", invalid: "需修正" };
export function VocabularyImportPanel({ onImported, onClose }: { onImported: (courseId: string) => void; onClose: () => void }) {
  const [preview, setPreview] = useState<VocabularyImportPreview | null>(null);
  const [title, setTitle] = useState("我的词表");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(1);
  const [imported, setImported] = useState<VocabularyImportConfirmation | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(""); setImported(null);
    try {
      const response = await fetch("/api/vocabulary/import/preview", { method: "POST", body: new FormData(event.currentTarget) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "词表暂时无法预览。");
      const value = (payload.preview ?? payload) as VocabularyImportPreview;
      if (!value.previewId || !Array.isArray(value.entries) || !value.summary) throw new Error("预览数据不完整，请重试。");
      setPreview(value); setPage(1);
    } catch (error) { setMessage(error instanceof Error ? error.message : "文件暂时无法读取。"); }
    finally { setBusy(false); }
  }
  async function confirm() {
    if (!preview || !title.trim() || busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/vocabulary/import/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ previewId: preview.previewId, expectedRevision: preview.revision, title: title.trim() }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "导入尚未完成，可以重试同一份预览。");
      setImported(payload as VocabularyImportConfirmation); setPreview(null); formRef.current?.reset(); onImported(payload.courseId);
    } catch (error) { setMessage(error instanceof Error ? error.message : "导入尚未确认，请重试。"); }
    finally { setBusy(false); }
  }
  const pages = preview ? Math.max(1, Math.ceil(preview.entries.length / 20)) : 1;
  const validCount = preview ? preview.summary.new + preview.summary.existing : 0;
  return <section className={ui.panel} aria-label="导入个人词表" data-vocabulary-import>
    <div className={ui.panelHeader}><div><h2>导入个人词表</h2><p>先预览，再确认。已有词的资料和复习进度会保留。</p></div><button type="button" className={ui.buttonGhost} disabled={busy} onClick={onClose}>收起</button></div>
    <form ref={formRef} onSubmit={upload} className={styles.importForm}><label className={ui.field}><span>TXT / CSV / Excel 文件</span><input className={ui.input} type="file" name="file" accept=".txt,.csv,.xlsx" required disabled={busy} onChange={() => { setPreview(null); setMessage(""); setImported(null); }} /></label><button className={ui.buttonSecondary} disabled={busy} type="submit">{busy ? "正在处理…" : "预览词表"}</button></form>
    <p className={styles.small}>TXT 可每行一个词，或用 Tab 分隔单词和中文释义；CSV / XLSX 支持 term、meaningZh、example 等列名。每次最多 5000 行。</p>
    {message && <p role="alert" className={ui.error}>{message}</p>}
    {imported && <div role="status" className={ui.notice}>已创建个人课程：新增 {imported.added} 个，关联已有 {imported.existing} 个，跳过 {imported.skipped} 个。{imported.readiness?.ready ? `${imported.readiness.ready} 个词可到课程页选择后学习。` : ""}{imported.readiness?.pending ? `${imported.readiness.pending} 个词需在课程页补齐释义、词性和两道语境题后发布。` : ""}导入未生成学习评分。</div>}
    {preview && <div className={styles.importPreview}>
      <h3>{preview.fileName}</h3><dl className={styles.progressStrip}><div><dt>总行数</dt><dd>{preview.summary.total}</dd></div>{(["new", "existing", "duplicate", "invalid"] as const).map((status) => <div key={status}><dt>{statusLabels[status]}</dt><dd>{preview.summary[status]}</dd></div>)}</dl>
      <div className={styles.tableScroll}><table className={styles.importTable}><thead><tr><th>行</th><th>词条 / 释义</th><th>处理结果</th></tr></thead><tbody>{preview.entries.slice((page - 1) * 20, page * 20).map((entry) => <tr key={entry.row}><td>{entry.row}</td><td><strong>{entry.term}</strong><small>{entry.meaningZh || "暂无中文释义"}</small></td><td><span>{statusLabels[entry.status]}</span>{entry.issues.map((issue) => <small key={issue} className={ui.error}>{issue}</small>)}</td></tr>)}</tbody></table></div>
      <nav className={styles.pagination} aria-label="导入预览分页"><button type="button" className={ui.buttonGhost} disabled={busy || page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button><span>{page} / {pages}</span><button type="button" className={ui.buttonGhost} disabled={busy || page >= pages} onClick={() => setPage((value) => value + 1)}>下一页</button></nav>
      {preview.readiness && <p className={styles.small}>可练 {preview.readiness.ready} 个；待补齐资料 {preview.readiness.pending} 个。未补齐的词不会进入练习。</p>}
      <div className={styles.importConfirm}><label className={ui.field}><span>个人课程名称</span><input className={ui.input} value={title} maxLength={200} disabled={busy} onChange={(event) => setTitle(event.target.value)} /></label><button type="button" className={ui.button} disabled={busy || !title.trim() || !validCount} onClick={() => void confirm()}>{busy ? "正在确认…" : `确认导入 ${validCount} 个有效词`}</button></div>
      <p className={styles.small}>预览有效期至 <time dateTime={preview.expiresAt}>{new Date(preview.expiresAt).toLocaleString("zh-CN")}</time>。无效行不会导入，可修正文件后重新预览。</p>
    </div>}
  </section>;
}
