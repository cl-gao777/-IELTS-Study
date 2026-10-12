"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { VocabularyCatalogEntry, VocabularyExercise } from "@/lib/vocabulary-course";
import ui from "./page-ui.module.css";
import styles from "./vocabulary.module.css";

type EntriesPage = { entries: VocabularyCatalogEntry[]; total: number; page: number; pageSize: number; restoreVersion: number };
function updatedExercise(entry: VocabularyCatalogEntry, original: VocabularyExercise | undefined, sentence: string, meaningZh: string): VocabularyExercise {
  const candidates = [...new Set([original?.targetSurface, entry.term, ...(original?.acceptedAnswers ?? [])].filter((value): value is string => Boolean(value)))];
  let match: RegExpExecArray | null = null;
  for (const candidate of candidates) {
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    match = new RegExp(`(?<![A-Za-z])${escaped}(?![A-Za-z])`, "i").exec(sentence); if (match) break;
  }
  if (!match) throw new Error(`例句需要准确包含词条 ${entry.term} 或原题词形。`);
  const sameSentence = sentence === original?.sentence;
  return { ...original, id: original?.id ?? crypto.randomUUID(), version: original?.version ?? 1, status: "published", sentence,
    targetStart: match.index, targetEnd: match.index + match[0].length, targetSurface: match[0],
    acceptedAnswers: sameSentence && original ? original.acceptedAnswers : [match[0]], meaningZh,
    source: sameSentence ? original?.source ?? "个人核对" : "个人核对原创例句", sourceReference: sameSentence ? original?.sourceReference : undefined };
}

export function VocabularyCourseEntries({ courseId, title, onClose, onPublished }: { courseId: string; title: string; onClose: () => void; onPublished: () => void }) {
  const [query, setQuery] = useState(""); const [status, setStatus] = useState<"all" | "draft" | "published">("draft");
  const [page, setPage] = useState(1); const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; value: EntriesPage | null; error: string } | null>(null);
  const [editing, setEditing] = useState<VocabularyCatalogEntry | null>(null); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [editingRestoreVersion, setEditingRestoreVersion] = useState<number | null>(null);
  const key = `${courseId}:${query}:${status}:${page}:${revision}`;
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ courseId, query, status, page: String(page), pageSize: "20" });
    fetch(`/api/vocabulary/courses/entries?${params}`, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "课程词条暂时无法读取。");
      if (!controller.signal.aborted) setResult({ key, value: payload as EntriesPage, error: "" });
    }).catch((error) => { if (!controller.signal.aborted) setResult({ key, value: null, error: error instanceof Error ? error.message : "课程词条暂时无法读取。" }); });
    return () => controller.abort();
  }, [courseId, query, status, page, revision, key]);
  const current = result?.key === key ? result : null;
  const draftIndices = editing?.exercises.map((exercise, index) => exercise.status === "draft" ? index : -1).filter((index) => index >= 0) ?? [];
  const exerciseIndices = draftIndices.length ? [draftIndices[0], draftIndices[1] ?? (draftIndices[0] === 0 ? 1 : 0)] : [0, 1];
  async function publish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing || !editingRestoreVersion || busy) return;
    const form = new FormData(event.currentTarget); setBusy(true); setMessage("");
    try {
      const meaningZh = String(form.get("meaningZh") || "").trim();
      const first = updatedExercise(editing, editing.exercises[exerciseIndices[0]], String(form.get("sentence0") || "").trim(), String(form.get("sense0") || meaningZh).trim());
      const second = updatedExercise(editing, editing.exercises[exerciseIndices[1]], String(form.get("sentence1") || "").trim(), String(form.get("sense1") || meaningZh).trim());
      if (first.sentence === second.sentence) throw new Error("请提供两句不同语境的自然例句。");
      const exercises = [...editing.exercises]; exercises[exerciseIndices[0]] = first; exercises[exerciseIndices[1]] = second;
      const response = await fetch("/api/vocabulary/courses/entries", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entryId: editing.id, expectedVersion: editing.version, meaningZh, restoreVersion: editingRestoreVersion,
        definitionEn: String(form.get("definitionEn") || "").trim(), partOfSpeech: String(form.get("partOfSpeech") || "").trim(), exercises }) });
      const payload = await response.json();
      if (response.status === 409) { setEditing(null); setEditingRestoreVersion(null); setRevision((value) => value + 1); throw new Error(`${payload.error || "资料已更新。"} 请重新打开词条核对。`); }
      if (!response.ok) throw new Error(payload.error || "核对未保存，请重试。");
      setEditing(null); setRevision((value) => value + 1); setMessage("词条已核对并发布，可用于后续新词学习。原有评分和复习进度保留。"); onPublished();
    } catch (error) { setMessage(error instanceof Error ? error.message : "核对尚未保存，请重试。"); }
    finally { setBusy(false); }
  }
  return <section className={ui.panel} aria-label="课程内容核对" data-course-entries>
    <div className={ui.panelHeader}><div><h2>{title} · 内容核对</h2><p>待核对的阅读原句不进入练习。补齐释义、词性和两句自然语境后发布。</p></div><button className={ui.buttonGhost} type="button" disabled={busy} onClick={onClose}>返回课程列表</button></div>
    <div className={styles.searchRow}><input className={ui.input} aria-label="搜索课程词条" placeholder="搜索英文或中文" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} /><select className={ui.input} aria-label="课程内容状态" value={status} onChange={(event) => { setStatus(event.target.value as typeof status); setPage(1); }}><option value="draft">待核对</option><option value="published">已发布</option><option value="all">全部</option></select></div>
    {message && <p role="status" className={ui.notice}>{message}</p>}
    {editing && <form className={styles.courseEditor} key={`${editing.id}:${editing.version}`} onSubmit={publish}>
      <div className={ui.panelHeader}><h3>{editing.term}</h3><button className={ui.buttonGhost} type="button" disabled={busy} onClick={() => setEditing(null)}>取消编辑</button></div>
      <fieldset disabled={busy} className={styles.editorFields}><div className={styles.fields}>{([ ["meaningZh", "中文释义"], ["definitionEn", "英文释义"], ["partOfSpeech", "词性"] ] as const).map(([name, label]) => <label key={name} className={ui.field}><span>{label}</span><input name={name} className={ui.input} defaultValue={editing[name]} required maxLength={2000} /></label>)}</div>
        {exerciseIndices.map((exerciseIndex, index) => <div key={exerciseIndex} className={styles.exerciseEditor}><label className={ui.field}><span>自然语境 {index + 1} · 准确包含该词</span><textarea className={ui.input} name={`sentence${index}`} rows={3} required maxLength={4000} defaultValue={editing.exercises[exerciseIndex]?.sentence ?? ""} /></label><label className={ui.field}><span>此句中该词的中文意思</span><input className={ui.input} name={`sense${index}`} defaultValue={editing.exercises[exerciseIndex]?.meaningZh || editing.meaningZh} maxLength={1000} required /></label>{editing.exercises[exerciseIndex]?.sourceReference && <p className={styles.small}>原文位置：{editing.exercises[exerciseIndex].sourceReference!.passageId} · PDF 第 {editing.exercises[exerciseIndex].sourceReference!.pdfPage} 页。修改原句后会标记为个人原创语境。</p>}</div>)}
        <button className={ui.button} type="submit">{busy ? "正在核对保存…" : "核对并发布"}</button>
      </fieldset></form>}
    {!current ? <p role="status">正在读取课程词条…</p> : current.error ? <div role="alert"><p>{current.error}</p><button type="button" className={ui.buttonSecondary} onClick={() => setRevision((value) => value + 1)}>重试读取</button></div>
      : <><div className={styles.wordList}>{current.value?.entries.map((entry) => <button type="button" key={entry.id} disabled={busy} onClick={() => { setEditing(entry); setEditingRestoreVersion(current.value!.restoreVersion); }}><span><strong>{entry.term}</strong><small>{entry.meaningZh || "待补充释义"}</small></span><span className={styles.scheduled}>{entry.status === "draft" || entry.exercises.some((exercise) => exercise.status === "draft") ? "待核对" : "已发布"} · 编辑</span></button>)}</div>{!current.value?.entries.length && <p>没有符合条件的课程词条。</p>}<nav className={styles.pagination} aria-label="课程词条分页"><button type="button" className={ui.buttonGhost} disabled={page <= 1 || busy} onClick={() => setPage((value) => value - 1)}>上一页</button><span>第 {page} / {Math.max(1, Math.ceil((current.value?.total ?? 0) / 20))} 页 · {current.value?.total ?? 0} 个</span><button type="button" className={ui.buttonGhost} disabled={page * 20 >= (current.value?.total ?? 0) || busy} onClick={() => setPage((value) => value + 1)}>下一页</button></nav></>}
  </section>;
}
