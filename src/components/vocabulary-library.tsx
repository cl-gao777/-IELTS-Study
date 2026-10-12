"use client";

import { type FormEvent, useEffect, useState } from "react";
import type { VocabularyEntry } from "@/lib/vocabulary";
import { isVocabularyNew } from "@/lib/vocabulary-practice";
import ui from "./page-ui.module.css";
import styles from "./vocabulary.module.css";

const fields: ReadonlyArray<readonly [keyof VocabularyEntry, string, boolean?]> = [
  ["term", "单词 / 短语", true], ["lemma", "Lemma · 原形"], ["ipa", "IPA · 音标"],
  ["pronunciation", "发音备注"], ["partOfSpeech", "词性"], ["meaningZh", "中文释义"],
  ["definitionEn", "English definition"], ["example", "Example sentence · 例句"],
  ["sourceSentence", "Source sentence · 来源句"], ["sourceMaterial", "Source material · 来源材料"],
  ["collocations", "Collocations · 搭配（逗号分隔）"], ["synonyms", "Synonyms · 同义词（逗号分隔）"],
  ["antonyms", "Antonyms · 反义词（逗号分隔）"], ["wordFamily", "Word family · 词族（逗号分隔）"],
  ["tags", "标签（如 Academic, Environment, Reading）"], ["notes", "笔记"],
];
const listFields = new Set(["tags", "collocations", "synonyms", "antonyms", "wordFamily"]);

export function VocabularyLibrary({ words, clock, busy, editor, onEdit, onSave }: {
  words: VocabularyEntry[]; clock: number; busy: boolean; editor: VocabularyEntry | "new" | null;
  onEdit: (word: VocabularyEntry | "new" | null) => void;
  onSave: (data: Record<string, string | string[]>, id?: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [dueOnly, setDueOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ key: string; words: VocabularyEntry[]; total: number; error: string } | null>(null);
  const search = query.trim().toLocaleLowerCase("en");
  const filtered = words.filter((word) => (!dueOnly || (!isVocabularyNew(word) && Date.parse(word.dueAt) <= clock)) && [word.term, word.meaningZh, word.lemma, ...word.tags].join(" ").toLocaleLowerCase("en").includes(search));
  const key = `${query}:${page}:${words.length}:${words.map((word) => word.reviewVersion).join(",")}`;
  useEffect(() => {
    if (dueOnly) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ query, page: String(page), pageSize: "20" });
    fetch(`/api/vocabulary?${params}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "词库暂时无法读取。");
      if (!controller.signal.aborted) setResult({ key, words: payload.words, total: payload.total, error: "" });
    }).catch((error) => { if (!controller.signal.aborted) setResult({ key, words: [], total: 0, error: error instanceof Error ? error.message : "词库暂时无法读取。" }); });
    return () => controller.abort();
  }, [query, page, dueOnly, key]);
  const current = result?.key === key ? result : null;
  const rows = dueOnly ? filtered.slice((page - 1) * 20, page * 20) : current?.words ?? [];
  const total = dueOnly ? filtered.length : current?.total ?? 0;
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const data = Object.fromEntries(fields.map(([name]) => [name, listFields.has(name) ? String(form.get(name) ?? "").split(/[,，]/).map((value) => value.trim()).filter(Boolean) : String(form.get(name) ?? "")]));
    onSave(data, editor && editor !== "new" ? editor.id : undefined);
  }
  return <section aria-label="词库管理" className={ui.stack} data-no-vocabulary>
    {editor && <form key={editor === "new" ? "new" : `${editor.id}:${editor.reviewVersion}`} className={`${ui.panel} ${styles.editor}`} onSubmit={save}>
      <div className={ui.panelHeader}><h2>{editor === "new" ? "添加个人词条" : `编辑 · ${editor.term}`}</h2><button className={ui.buttonGhost} type="button" disabled={busy} onClick={() => onEdit(null)}>收起</button></div>
      <fieldset className={styles.editorFields} disabled={busy}><div className={styles.fields}>{fields.map(([name, label, required]) => {
        const value = editor === "new" ? "" : editor[name];
        return <label className={ui.field} key={name}><span>{label}</span><input className={ui.input} name={name} required={required ?? false} defaultValue={Array.isArray(value) ? value.join(", ") : String(value ?? "")} maxLength={name === "notes" ? 5000 : name === "term" ? 100 : 2000} /></label>;
      })}</div><button className={ui.button} type="submit">{busy ? "正在保存…" : "保存词条"}</button></fieldset>
    </form>}
    <div className={ui.panel}>
      <div className={ui.panelHeader}><h2>我的词库 · {words.length}</h2><p>包含个人添加和已开始学习的词。公开课程内容可在课程页搜索。</p></div>
      <input className={ui.input} aria-label="搜索词库" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索英文、中文或标签" disabled={busy} />
      <label className={styles.filter}><input type="checkbox" checked={dueOnly} onChange={(event) => { setDueOnly(event.target.checked); setPage(1); }} disabled={busy} /> 只看到期词</label>
      {!dueOnly && !current && <p role="status">正在搜索词库…</p>}{current?.error && <p role="alert" className={ui.error}>{current.error}</p>}
      <div className={styles.wordList}>{rows.map((word) => <button type="button" disabled={busy} className={editor !== "new" && editor?.id === word.id ? styles.selected : ""} key={word.id} onClick={() => onEdit(word)}><span><strong>{word.term}</strong><small>{word.meaningZh || word.definitionEn || "待补充释义"}</small></span><span className={!isVocabularyNew(word) && Date.parse(word.dueAt) <= clock ? styles.due : styles.scheduled}>{isVocabularyNew(word) ? "尚未开始学习" : Date.parse(word.dueAt) <= clock ? "到期" : "下次 " + new Date(word.dueAt).toLocaleString("zh-CN")}</span></button>)}</div>
      {(dueOnly || current) && !rows.length && !current?.error && <p>没有符合条件的词条。</p>}
      <nav className={styles.pagination} aria-label="我的词库分页"><button type="button" className={ui.buttonGhost} disabled={busy || page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button><span>{page} / {Math.max(1, Math.ceil(total / 20))} · {total} 个</span><button type="button" className={ui.buttonGhost} disabled={busy || page * 20 >= total} onClick={() => setPage((value) => value + 1)}>下一页</button></nav>
    </div>
  </section>;
}
