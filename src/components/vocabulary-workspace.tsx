"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReviewRating } from "@/lib/srs";
import { normaliseVocabularyAnswer, speakEnglish, vocabularyContextGap, type VocabularyEntry, type VocabularyReviewMode } from "@/lib/vocabulary";
import ui from "./page-ui.module.css";
import styles from "./vocabulary.module.css";

const modes: { value: VocabularyReviewMode; label: string; description: string }[] = [
  { value: "recognition", label: "Recognition · 认词", description: "看英文，回忆中文或英文释义。" },
  { value: "recall", label: "Recall · 回忆", description: "看释义，输入英文单词或短语。" },
  { value: "spelling", label: "Spelling · 听写", description: "听发音，输入英文；使用浏览器英式发音。" },
  { value: "context", label: "Context · 语境", description: "根据原句，填写空缺的单词或短语。" },
];
const ratings: { value: ReviewRating; label: string }[] = [
  { value: "again", label: "Again · 忘记" }, { value: "hard", label: "Hard · 困难" },
  { value: "good", label: "Good · 记得" }, { value: "easy", label: "Easy · 轻松" },
];
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

export function VocabularyWorkspace({ initialWords, nowIso }: { initialWords: VocabularyEntry[]; nowIso: string }) {
  const [words, setWords] = useState(initialWords);
  const [clock, setClock] = useState(Date.parse(nowIso));
  const [selectedId, setSelectedId] = useState(initialWords.find((word) => Date.parse(word.dueAt) <= Date.parse(nowIso))?.id ?? "");
  const [mode, setMode] = useState<VocabularyReviewMode>("recognition");
  const [revealed, setRevealed] = useState(false);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [dueOnly, setDueOnly] = useState(false);
  const [message, setMessage] = useState("");
  const [editor, setEditor] = useState<VocabularyEntry | "new" | null>(null);
  const startedAt = useRef<number>(0);

  useEffect(() => {
    startedAt.current = Date.now();
    const interval = window.setInterval(() => setClock(Date.now()), 30_000);
    function captured(event: Event) {
      const word = (event as CustomEvent<VocabularyEntry>).detail;
      setWords((current) => [word, ...current.filter((item) => item.id !== word.id)]);
      setClock(Date.now());
    }
    window.addEventListener("studio:vocabulary-added", captured);
    return () => { window.clearInterval(interval); window.removeEventListener("studio:vocabulary-added", captured); };
  }, []);

  const dueWords = useMemo(() => words.filter((word) => Date.parse(word.dueAt) <= clock), [words, clock]);
  const selected = useMemo(() => words.find((word) => word.id === selectedId) ?? dueWords[0], [words, selectedId, dueWords]);
  const search = query.trim().toLowerCase();
  const filtered = words.filter((word) => (!dueOnly || Date.parse(word.dueAt) <= clock) && [word.term, word.meaningZh, word.lemma, ...word.tags].join(" ").toLowerCase().includes(search));
  const context = selected ? vocabularyContextGap(selected.term, selected.sourceSentence || selected.example) : null;
  const requiresTyping = mode !== "recognition";
  const correct = selected && requiresTyping ? normaliseVocabularyAnswer(answer) === normaliseVocabularyAnswer(selected.term) : null;
  const modeReady = mode !== "context" || Boolean(context);

  const resetCard = useCallback(() => { setRevealed(false); setAnswer(""); startedAt.current = Date.now(); }, []);
  function speak(text: string) { if (!speakEnglish(text)) setMessage("此浏览器暂不支持发音，请使用 Windows Edge 或 Chrome 并启用英语语音。"); }

  const review = useCallback(async (rating: ReviewRating) => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/vocabulary/${encodeURIComponent(selected.id)}/review`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, mode, userAnswer: answer, correct, durationSeconds: Math.min(3600, Math.max(0, Math.round((Date.now() - startedAt.current) / 1000))) }),
      });
      const payload = await response.json() as { word?: VocabularyEntry; error?: string };
      if (!response.ok || !payload.word) throw new Error(payload.error ?? "复习暂未保存，请重试。");
      const updated = payload.word;
      setWords((current) => current.map((word) => word.id === updated.id ? updated : word));
      setSelectedId(dueWords.find((word) => word.id !== selected.id)?.id ?? "");
      setClock(Date.now());
      resetCard();
      setMessage(`${selected.term} 已保存。FSRS 下次复习：${new Date(updated.dueAt).toLocaleString("zh-CN")}${rating === "again" ? "；已加入错题库。" : "。"}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "网络错误，请重试；当前回答仍在页面中。"); }
    finally { setBusy(false); }
  }, [answer, busy, correct, dueWords, mode, resetCard, selected]);

  const saveWord = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const data = Object.fromEntries(fields.map(([name]) => [name, listFields.has(name) ? String(form.get(name) ?? "").split(/[,，]/).map((value) => value.trim()).filter(Boolean) : String(form.get(name) ?? "")]));
    const editing = editor && editor !== "new" ? editor : null;
    setBusy(true);
    try {
      const response = await fetch(editing ? `/api/vocabulary/${encodeURIComponent(editing.id)}` : "/api/vocabulary", {
        method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
      });
      const payload = await response.json() as { word?: VocabularyEntry; error?: string; existing?: boolean };
      if (!response.ok || !payload.word) throw new Error(payload.error ?? "无法保存单词。");
      const saved = payload.word;
      setWords((current) => [saved, ...current.filter((word) => word.id !== saved.id)]);
      setSelectedId(saved.id); setClock(Date.now()); setEditor(null); resetCard();
      setMessage(payload.existing ? "该单词已在词库中，已打开已有词条。" : editing ? "词条已更新，复习进度保留。" : "新词已加入 Due Today。可以随时补充释义和来源。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败，请重试。"); }
    finally { setBusy(false); }
  }, [busy, editor, resetCard]);

  return <div className={ui.page}>
    <header className={ui.pageHeader}>
      <div><p className={ui.eyebrow}>Vocabulary / FSRS</p><h1>个人词库</h1><p>从阅读、听力和写作中收集词汇。主动回忆后评分，所有词条与复习记录保存在本地。</p></div>
      <div className={ui.headerActions}><span className={ui.pill}>Due Today · {dueWords.length} 个到期</span><button className={ui.button} onClick={() => setEditor("new")}>＋ 添加词条</button></div>
    </header>
    {message && <div role="status" className={ui.notice}>{message}</div>}
    {editor && <form key={editor === "new" ? "new" : editor.id} className={`${ui.panel} ${styles.editor}`} onSubmit={saveWord}>
      <div className={ui.panelHeader}><h2>{editor === "new" ? "添加个人词条" : `编辑 · ${editor.term}`}</h2><button className={ui.buttonGhost} type="button" onClick={() => setEditor(null)}>收起</button></div>
      <div className={styles.fields}>{fields.map(([name, label, required]) => {
        const value = editor === "new" ? "" : editor[name];
        return <label className={ui.field} key={name}><span>{label}</span><input className={ui.input} name={name} required={required ?? false} defaultValue={Array.isArray(value) ? value.join(", ") : String(value ?? "")} maxLength={name === "notes" ? 5000 : name === "term" ? 100 : 2000} /></label>;
      })}</div>
      <button className={ui.button} disabled={busy}>{busy ? "正在保存…" : "保存词条"}</button>
    </form>}
    <div className={styles.modes} aria-label="复习模式">{modes.map((item) => <button key={item.value} type="button" className={mode === item.value ? styles.activeMode : ""} onClick={() => { setMode(item.value); resetCard(); }}>{item.label}</button>)}</div>
    <div className={styles.layout}>
      <section className={`${ui.panel} ${styles.card}`}>
        <div className={styles.cardHeader}><span>{modes.find((item) => item.value === mode)?.description}</span>{selected && <button className={ui.buttonGhost} onClick={() => setEditor(selected)}>编辑词条</button>}</div>
        {selected ? <>
          <div className={styles.front}>
            {mode === "recognition" && <><span>{selected.ipa || selected.pronunciation} {selected.partOfSpeech}</span><h2>{selected.term}</h2><button className={ui.buttonGhost} onClick={() => speak(selected.term)}>▶ 英式发音</button></>}
            {mode === "recall" && <><h2>{selected.meaningZh || selected.definitionEn || "请先编辑并补充释义"}</h2><p>{selected.meaningZh ? selected.definitionEn : ""}</p></>}
            {mode === "spelling" && <><h2>听音写词</h2><button className={ui.button} onClick={() => speak(selected.term)}>▶ 播放 / 重听</button><p>声音由浏览器 SpeechSynthesis 提供，无需 AI API。</p></>}
            {mode === "context" && <><h2>语境填词</h2><blockquote>{context ?? "这张卡还没有包含该词的例句。编辑词条，补充来源句或例句后即可练习。"}</blockquote></>}
          </div>
          {requiresTyping && modeReady && <label className={styles.answer}><span>你的答案</span><input className={ui.input} value={answer} onChange={(event) => setAnswer(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") setRevealed(true); }} placeholder="输入英文单词或短语" autoComplete="off" spellCheck={false} disabled={revealed} /></label>}
          {!revealed ? <button className={ui.button} disabled={!modeReady || (requiresTyping && !answer.trim())} onClick={() => setRevealed(true)}>{requiresTyping ? "核对答案" : "显示答案"}</button> : <div className={styles.back}>
            <h2>{selected.term} <button className={ui.buttonGhost} aria-label="播放单词" onClick={() => speak(selected.term)}>▶</button></h2>
            <strong>{selected.meaningZh || "尚未补充中文释义"}</strong><p>{selected.definitionEn}</p>
            {requiresTyping && <p className={correct ? styles.correct : styles.wrong}>{correct ? "✓ 拼写正确" : `✗ 你的答案：${answer}。请选择 Again，重新学习。`}</p>}
            {(selected.example || selected.sourceSentence) && <blockquote>{selected.example || selected.sourceSentence}<button className={ui.buttonGhost} onClick={() => speak(selected.example || selected.sourceSentence)}>▶ 读例句</button></blockquote>}
            <div className={styles.ratings}>{ratings.map((rating) => <button type="button" disabled={busy || (correct === false && rating.value !== "again")} key={rating.value} onClick={() => review(rating.value)}>{rating.label}</button>)}</div>
            <p className={styles.small}>FSRS 根据实际复习历史安排下次出现时间。Again 会同步保存到错题库。</p>
            <dl className={styles.details}>
              {selected.lemma && <><dt>原形</dt><dd>{selected.lemma}</dd></>}
              {selected.sourceMaterial && <><dt>来源</dt><dd>{selected.sourceMaterial}</dd></>}
              {selected.sourceSentence && <><dt>来源句</dt><dd>{selected.sourceSentence}</dd></>}
              {([ ["搭配", selected.collocations], ["同义词", selected.synonyms], ["反义词", selected.antonyms], ["词族", selected.wordFamily], ["标签", selected.tags] ] as const).filter(([, values]) => values.length).map(([label, values]) => <div key={label}><dt>{label}</dt><dd>{values.join(" · ")}</dd></div>)}
              {selected.notes && <><dt>笔记</dt><dd>{selected.notes}</dd></>}
            </dl>
          </div>}
        </> : <div className={styles.front}><h2>{words.length ? "当前到期词已复习完成" : "从第一篇文章开始积累"}</h2><p>{words.length ? "稍后到期的卡片会自动进入队列；也可以从右侧选择词条加练。" : "在任意页面选中英文，点击 Add to Vocabulary；也可以手动添加。"}</p>{words.length > 0 && <p>下次到期：{new Date([...words].sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))[0].dueAt).toLocaleString("zh-CN")}</p>}</div>}
      </section>
      <aside className={ui.panel}><div className={ui.panelHeader}><h2>我的词库 · {words.length}</h2></div>
        <input className={ui.input} aria-label="搜索词库" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索英文、中文或标签" />
        <label className={styles.filter}><input type="checkbox" checked={dueOnly} onChange={(event) => setDueOnly(event.target.checked)} /> 只看到期词</label>
        <div className={styles.wordList}>{filtered.map((word) => <button type="button" className={selected?.id === word.id ? styles.selected : ""} key={word.id} onClick={() => { setSelectedId(word.id); resetCard(); }}><span><strong>{word.term}</strong><small>{word.meaningZh || word.definitionEn || "待补充释义"}</small></span><span className={Date.parse(word.dueAt) <= clock ? styles.due : styles.scheduled}>{Date.parse(word.dueAt) <= clock ? "到期" : "已安排"}</span></button>)}</div>
        {!filtered.length && <p>没有符合条件的词条。</p>}
      </aside>
    </div>
  </div>;
}
