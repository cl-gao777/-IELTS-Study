"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { speakEnglish, type VocabularyEntry } from "@/lib/vocabulary";
import ui from "./page-ui.module.css";
import styles from "./vocabulary.module.css";

interface SelectionContext { term: string; sentence: string; material: string; path: string }

function sentenceAround(text: string, term: string) {
  const sentences = text.replace(/\s+/g, " ").match(/[^.!?]+(?:[.!?]|$)/g) ?? [];
  return (sentences.find((sentence) => sentence.toLowerCase().includes(term.toLowerCase())) ?? text).trim().slice(0, 2000);
}

/** Mount once inside AppShell. Captures only an explicit selection, never field values such as API keys. */
export function VocabularyCapture() {
  const pathname = usePathname();
  const [selection, setSelection] = useState<SelectionContext | null>(null);
  const [meaning, setMeaning] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    function capture(event: MouseEvent | KeyboardEvent) {
      if (pathname === "/vocabulary") return;
      if (event instanceof KeyboardEvent && !event.key.startsWith("Arrow") && event.key !== "Shift") return;
      const target = event.target as HTMLElement | null;
      if (!target || target.closest("[data-vocabulary-capture], input, select, [data-no-vocabulary]")) return;
      let term = "";
      let element: Element | null = null;
      let sentence = "";
      if (target instanceof HTMLTextAreaElement) {
        term = target.value.slice(target.selectionStart, target.selectionEnd).trim();
        sentence = sentenceAround(target.value, term);
        element = target;
      } else {
        const current = window.getSelection();
        if (!current || current.isCollapsed || !current.rangeCount) return;
        term = current.toString().trim().replace(/\s+/g, " ");
        const anchor = current.getRangeAt(0).commonAncestorContainer;
        element = anchor instanceof Element ? anchor : anchor.parentElement;
        if (element?.closest("[data-vocabulary-capture], input, [data-no-vocabulary]")) return;
        sentence = sentenceAround(element?.closest("p, li, blockquote, pre, article, section")?.textContent ?? element?.textContent ?? term, term);
      }
      if (!/^[A-Za-z][A-Za-z\s'’\-]*$/.test(term) || term.length > 100 || term.split(/\s+/).length > 12) return;
      const source = element?.closest("[data-source-material]")?.getAttribute("data-source-material");
      const title = source || document.querySelector("main h1")?.textContent || document.querySelector("h1")?.textContent || document.title;
      setSelection({ term, sentence, material: `${title} (${pathname})`.slice(0, 500), path: pathname });
      setMeaning(""); setSaved(false); setMessage("");
    }
    function escape(event: KeyboardEvent) { if (event.key === "Escape") setSelection(null); }
    document.addEventListener("mouseup", capture);
    document.addEventListener("keyup", capture);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mouseup", capture); document.removeEventListener("keyup", capture); document.removeEventListener("keydown", escape); };
  }, [pathname]);

  async function save() {
    if (!selection || busy) return;
    setBusy(true);
    try {
      const area = selection.path.split("/")[1];
      const tag = ({ reading: "Reading", listening: "Listening", writing: "Writing" } as Record<string, string>)[area];
      const response = await fetch("/api/vocabulary", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term: selection.term, meaningZh: meaning, sourceSentence: selection.sentence, sourceMaterial: selection.material, tags: tag ? [tag] : [] }),
      });
      const payload = await response.json() as { word?: VocabularyEntry; existing?: boolean; error?: string };
      if (!response.ok || !payload.word) throw new Error(payload.error ?? "保存失败，请重试。");
      window.dispatchEvent(new CustomEvent("studio:vocabulary-added", { detail: payload.word }));
      setSaved(true); setMessage(payload.existing ? "词库中已有这个词，已保留原词条与复习进度。" : "已加入本地词库，可在 Vocabulary 补充释义与词族。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "网络错误，所选内容仍保留，请重试。"); }
    finally { setBusy(false); }
  }

  if (pathname === "/vocabulary" || !selection || selection.path !== pathname) return null;
  return <aside className={styles.capture} data-vocabulary-capture aria-label="添加选中单词">
    <div className={styles.captureHeader}><strong>{selection.term}</strong><button type="button" aria-label="关闭选词" onClick={() => setSelection(null)}>×</button></div>
    <p>{selection.sentence.slice(0, 200)}{selection.sentence.length > 200 ? "…" : ""}</p>
    {!saved && <label>中文释义（可稍后补充）<input className={ui.input} value={meaning} onChange={(event) => setMeaning(event.target.value)} maxLength={500} /></label>}
    <div className={styles.captureActions}>
      {!saved && <button className={ui.button} type="button" disabled={busy} onClick={save}>{busy ? "正在保存…" : "Add to Vocabulary · 加入词库"}</button>}
      <button className={ui.buttonGhost} type="button" onClick={() => { if (!speakEnglish(selection.term)) setMessage("浏览器未提供 SpeechSynthesis 发音。"); }}>▶ 发音</button>
      {saved && <Link className={ui.button} href="/vocabulary" onClick={() => setSelection(null)}>打开词库</Link>}
    </div>
    {message && <p role="status">{message}</p>}
  </aside>;
}
