"use client";

import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import type { SourceMaterial } from "@/lib/domain";
import { countWritingWords, writingCategories, writingDraftSchema, type WritingDraft, type WritingDraftInput, type WritingFeedbackRecord } from "@/lib/writing";
import ui from "./page-ui.module.css";
import styles from "./writing.module.css";

const cacheKey = "ielts-studio-writing-recovery";
const taskPrompts = {
  "task-1": "The table shows the percentage of commuters using three modes of transport in a fictional town in 2010 and 2025. Car: 60%, 42%; Bus: 25%, 33%; Bicycle: 15%, 25%. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.",
  "task-2": "Some people believe cities should spend more money on public transport than on building new roads. To what extent do you agree or disagree?",
};
function blankDraft(taskType: WritingDraft["taskType"]): WritingDraft {
  const id = crypto.randomUUID();
  return { id, groupId: id, version: 1, taskType, category: taskType === "task-1" ? "Table" : "Opinion", prompt: taskPrompts[taskType], image: "", essay: "", elapsedSeconds: 0, timeLimitMinutes: taskType === "task-1" ? 20 : 40, status: "draft", updatedAt: new Date().toISOString() };
}
function formatTime(seconds: number) {
  const value = Math.abs(seconds);
  return `${seconds < 0 ? "+" : ""}${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
function DraftFeedback({ feedback, taskType }: { feedback: WritingFeedbackRecord; taskType: WritingDraft["taskType"] }) {
  const criteria = [
    ["taskResponse", taskType === "task-1" ? "Task Achievement · 任务完成" : "Task Response · 任务回应"],
    ["coherenceCohesion", "Coherence & Cohesion · 连贯衔接"],
    ["lexicalResource", "Lexical Resource · 词汇"],
    ["grammarAccuracy", "Grammatical Range & Accuracy · 语法"],
  ] as const;
  return <>
    <p>{feedback.overall}</p>
    <div className={styles.criteria}>{criteria.map(([key, label]) => <div key={key}>
      <span>{label}</span><strong>{feedback.criteria[key].toFixed(1)}</strong>
      <p>{feedback.criterionFeedback[key]}</p>
    </div>)}</div>
    <div className={styles.feedbackList}>
      <h3>Strong Sentences · 好句</h3>
      {feedback.strongSentences.length ? <ul>{feedback.strongSentences.map((item, i) => <li key={i}>{item}</li>)}</ul> : <p>本次未标注。</p>}
      <h3>Weak Sentences · 句子修改</h3>
      {feedback.weakSentences.map((item, i) => <div className={styles.correction} key={i}><del>{item.original}</del><ins>{item.suggestion}</ins><p>{item.explanation}</p></div>)}
      {([ ["Grammar Errors · 语法错误", feedback.grammarErrors], ["Vocabulary Problems · 用词问题", feedback.vocabularyProblems] ] as const).map(([title, errors]) => <div key={title}>
        <h3>{title}</h3>{errors.length ? errors.map((item, i) => <div className={styles.correction} key={i}><small>{item.category} · 已加入 Mistakes</small><del>{item.original}</del><ins>{item.correction}</ins><p>{item.explanation}</p></div>) : <p>本次未标注。</p>}
      </div>)}
      <h3>Better Expressions · 更准确的表达</h3>
      {feedback.betterExpressions.map((item, i) => <div className={styles.correction} key={i}><del>{item.original}</del><ins>{item.suggestion}</ins><p>{item.explanation}</p></div>)}
      <h3>Action Items · 下次改写</h3><ol>{feedback.actionItems.map((item, i) => <li key={i}>{item}</li>)}</ol>
    </div>
    <details className={styles.rewrite}><summary>Suggested Rewrite · 查看建议改写</summary><p>{feedback.rewrite}</p></details>
  </>;
}

export function WritingWorkspace({ initialDrafts, materials }: { initialDrafts: WritingDraft[]; materials: SourceMaterial[] }) {
  const [draft, setDraft] = useState<WritingDraft>(() => initialDrafts[0] ?? blankDraft("task-2"));
  const [history, setHistory] = useState(initialDrafts);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState("等待自动保存");
  const [error, setError] = useState("");
  const [compareId, setCompareId] = useState("");
  const draftRef = useRef(draft);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const savedTimestamp = useRef(initialDrafts[0]?.updatedAt ?? "");
  const startedAt = useRef(0);

  useEffect(() => {
    let mounted = true;
    async function recover() {
      try {
        const raw = localStorage.getItem(cacheKey);
        const restored = raw ? writingDraftSchema.safeParse(JSON.parse(raw)) : null;
        if (mounted && restored?.success && restored.data.updatedAt > (initialDrafts[0]?.updatedAt ?? "")) {
          const previous = initialDrafts.find((item) => item.id === restored.data.id);
          const recovered = { ...previous, ...restored.data };
          draftRef.current = recovered;
          setDraft(recovered);
          setSaveStatus("已恢复浏览器中未完成的草稿");
        }
      } catch { /* SQLite remains authoritative when browser storage is unavailable. */ }
      if (mounted) setReady(true);
    }
    void recover();
    return () => { mounted = false; };
  }, [initialDrafts]);

  const remember = useCallback((next: WritingDraft) => {
    draftRef.current = next;
    setDraft(next);
    try { localStorage.setItem(cacheKey, JSON.stringify(next)); } catch { /* Server autosave continues. */ }
  }, []);

  const persist = useCallback((snapshot: WritingDraftInput): Promise<void> => {
    setSaveStatus("正在保存…");
    const pending = saveQueue.current.catch(() => undefined).then(async () => {
      const response = await fetch("/api/writing/drafts", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(snapshot) });
      const payload = await response.json() as { draft?: WritingDraft; error?: string };
      if (!response.ok || !payload.draft) throw new Error(payload.error ?? "保存失败");
      savedTimestamp.current = snapshot.updatedAt;
      setHistory((items) => [payload.draft!, ...items.filter((item) => item.id !== snapshot.id)]);
      setSaveStatus(draftRef.current.updatedAt === snapshot.updatedAt ? "已保存到本地 SQLite" : "正在保存后续修改…");
    });
    saveQueue.current = pending;
    return pending.catch((cause: unknown) => {
      setSaveStatus("保存失败 · 请重试，勿关闭页面");
      setError(cause instanceof Error ? cause.message : "保存失败，请保留页面后重试。");
      throw cause;
    });
  }, []);

  useEffect(() => {
    if (!ready || savedTimestamp.current === draft.updatedAt) return;
    // Flush at a fixed interval below as well, so continuous typing never starves autosave.
    const timeout = window.setTimeout(() => { void persist(draft).catch(() => undefined); }, 1200);
    return () => window.clearTimeout(timeout);
  }, [draft, persist, ready]);

  useEffect(() => {
    if (!ready) return;
    const interval = window.setInterval(() => {
      if (savedTimestamp.current !== draftRef.current.updatedAt) void persist(draftRef.current).catch(() => undefined);
    }, 5000);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (savedTimestamp.current !== draftRef.current.updatedAt) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("beforeunload", beforeUnload);
      if (savedTimestamp.current !== draftRef.current.updatedAt) void persist(draftRef.current).catch(() => undefined);
    };
  }, [persist, ready]);

  const update = useCallback((changes: Partial<WritingDraftInput>) => {
    remember({ ...draftRef.current, ...changes, updatedAt: new Date().toISOString() });
  }, [remember]);

  useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(() => update({ elapsedSeconds: Math.floor((Date.now() - startedAt.current) / 1000) }), 1000);
    return () => window.clearInterval(interval);
  }, [running, update]);

  async function switchDraft(next: WritingDraft) {
    setRunning(false); setBusy(true); setError("");
    try { await persist(draftRef.current); remember(next); setCompareId(""); }
    catch { /* Keep the current text visible when the save fails. */ }
    finally { setBusy(false); }
  }
  async function newRevision() {
    setRunning(false); setBusy(true); setError("");
    try {
      await persist(draftRef.current);
      const response = await fetch("/api/writing/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId: draftRef.current.id, id: crypto.randomUUID() }) });
      const payload = await response.json() as { draft?: WritingDraft; error?: string };
      if (!response.ok || !payload.draft) throw new Error(payload.error ?? "创建版本失败");
      setCompareId(draftRef.current.id); remember(payload.draft);
      setHistory((items) => [payload.draft!, ...items]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "创建版本失败，原稿已保留。"); }
    finally { setBusy(false); }
  }
  async function evaluate() {
    if (busy) return;
    setRunning(false); setBusy(true); setError("");
    const snapshot = draftRef.current;
    try {
      await persist(snapshot);
      const response = await fetch("/api/writing/evaluate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(snapshot) });
      const payload = await response.json() as { feedback?: WritingFeedbackRecord; error?: string };
      if (!response.ok || !payload.feedback) throw new Error(payload.error ?? "反馈请求失败；草稿已保留。");
      const next = { ...draftRef.current, feedback: payload.feedback };
      remember(next);
      setHistory((items) => items.map((item) => item.id === next.id ? next : item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "网络连接失败；请重试，草稿已保留。"); }
    finally { setBusy(false); }
  }
  async function finishDraft() {
    setRunning(false); setBusy(true); setError("");
    const next = { ...draftRef.current, status: "completed" as const, updatedAt: new Date().toISOString() };
    remember(next);
    try { await persist(next); } catch { /* Error is displayed by persist. */ }
    finally { setBusy(false); }
  }
  function importImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 3 * 1024 * 1024) {
      setError("请选择不超过 3 MB 的 PNG、JPEG 或 WebP 图片。"); event.target.value = ""; return;
    }
    const reader = new FileReader();
    reader.onload = () => { update({ image: String(reader.result) }); setError(""); };
    reader.onerror = () => setError("图片读取失败，请重试。");
    reader.readAsDataURL(file);
  }

  const wordCount = countWritingWords(draft.essay);
  const targetWords = draft.taskType === "task-1" ? 150 : 250;
  const feedback = draft.feedback;
  const samePrompt = history.filter((item) => item.groupId === draft.groupId).sort((a, b) => a.version - b.version);
  const compared = history.find((item) => item.id === compareId);

  return <div className={ui.page}>
    <header className={ui.pageHeader}><div><p className={ui.eyebrow}>Academic Writing</p><h1>写作工作台</h1><p>独立写作 → 四项反馈 → 错误复习 → 改写对比。没有 AI 也能计时、保存与改写。</p></div>
      <div className={ui.headerActions}><span className={ui.pill}>{wordCount} / {targetWords}+ words</span><span className={styles.clock}>{formatTime(draft.timeLimitMinutes * 60 - draft.elapsedSeconds)}</span></div>
    </header>
    <div className={styles.toolbar}>
      <label>草稿 / Improvement History<select value={draft.id} disabled={busy || !ready} onChange={(event) => { const next = history.find((item) => item.id === event.target.value); if (next) void switchDraft(next); }}>
        {!history.some((item) => item.id === draft.id) && <option value={draft.id}>新草稿 · Draft {draft.version}</option>}
        {history.map((item) => <option key={item.id} value={item.id}>{item.taskType.toUpperCase()} · {item.category} · Draft {item.version} · {item.prompt.slice(0, 45)}</option>)}
      </select></label>
      <button className={ui.buttonSecondary} disabled={busy || !ready} onClick={() => void switchDraft(blankDraft("task-1"))}>新建 Task 1</button>
      <button className={ui.buttonSecondary} disabled={busy || !ready} onClick={() => void switchDraft(blankDraft("task-2"))}>新建 Task 2</button>
    </div>
    <div className={styles.writingGrid}>
      <section className={`${ui.panel} ${styles.editorPanel}`} data-source-material={`Writing ${draft.taskType} · ${draft.prompt.slice(0, 100)}`}>
        <div className={styles.taskTabs}><strong>{draft.taskType === "task-1" ? "Academic Task 1" : "Task 2"} · Draft {draft.version}</strong><span className={ui.pill}>{draft.status === "completed" ? "已完成" : "草稿"}</span></div>
        <div className={styles.settingsRow}>
          <label>题型<select value={draft.category} disabled={busy} onChange={(event) => update({ category: event.target.value })}>{writingCategories[draft.taskType].map((category) => <option key={category}>{category}</option>)}</select></label>
          <label>目标时长（分钟）<input type="number" min={1} max={240} value={draft.timeLimitMinutes} disabled={busy} onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= 240) update({ timeLimitMinutes: value }); }} /></label>
          <button className={ui.buttonSecondary} disabled={busy} onClick={() => { if (!running) startedAt.current = Date.now() - draft.elapsedSeconds * 1000; setRunning(!running); }}>{running ? "暂停计时" : "开始 / 继续"}</button>
          <span>已用 {formatTime(draft.elapsedSeconds)}</span>
        </div>
        {materials.length > 0 && <label className={styles.importLabel}>从 Materials 导入题目<select defaultValue="" disabled={busy} onChange={(event) => { const item = materials.find((material) => material.id === Number(event.target.value)); if (item) update({ prompt: item.content.slice(0, 10000) }); event.target.value = ""; }}><option value="">选择 Writing prompt</option>{materials.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
        <div className={ui.field}><label htmlFor="writing-prompt">Prompt · 题目（示例题目为原创，可替换）</label><textarea id="writing-prompt" className={`${ui.textarea} ${styles.promptInput}`} value={draft.prompt} disabled={busy} maxLength={10000} onChange={(event) => update({ prompt: event.target.value })} /></div>
        <div className={styles.imageImport}><label>题目图片<input aria-label="导入题目图片" type="file" accept="image/png,image/jpeg,image/webp" onChange={importImage} disabled={busy} /></label>{draft.image && <button className={ui.buttonGhost} disabled={busy} onClick={() => update({ image: "" })}>移除图片</button>}</div>
        {draft.image && <figure className={styles.promptFigure}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Local user image data does not need an image optimizer. */}
          <img src={draft.image} alt="用户导入的写作题目图表" />
          <figcaption>图片保存在本地。AI 只接收文本；请在 Prompt 补充图表数据。</figcaption>
        </figure>}
        <div className={styles.document}><textarea aria-label="Essay · 作文" value={draft.essay} disabled={busy} maxLength={100000} onChange={(event) => update({ essay: event.target.value, status: "draft" })} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void finishDraft(); } }} placeholder="Write your response here. Separate paragraphs with a blank line…" spellCheck />
          <footer><span>{wordCount < targetWords ? `距离建议最低字数还差 ${targetWords - wordCount} 词` : "已达到建议最低字数"}</span><span role="status">{saveStatus}</span></footer>
        </div>
        {error && <div className={ui.error} role="alert">{error}</div>}
        <div className={styles.submitRow}>
          <button className={ui.buttonSecondary} disabled={busy || !ready} onClick={() => void persist(draftRef.current).catch(() => undefined)}>保存草稿</button>
          <button className={ui.buttonSecondary} disabled={busy || !ready || !draft.essay.trim()} onClick={() => void finishDraft()}>完成并保存</button>
          <button className={ui.button} disabled={busy || !ready || draft.essay.trim().length < 40} onClick={() => void evaluate()}>{busy ? "处理中…" : "请求 AI 反馈"}</button>
        </div>
        <small className={styles.help}>Ctrl / Cmd + Enter 完成并保存。请求 AI 反馈会把题目和作文发送到已配置的 Provider。未配置时不生成评分。</small>
      </section>
      <aside className={ui.stack}>
        <section className={`${ui.panel} ${styles.feedbackPanel}`}>
          <div className={ui.panelHeader}><div><p className={ui.eyebrow}>Feedback</p><h2>{feedback ? `AI Estimated Band ${feedback.overallBand.toFixed(1)}` : "等待写作反馈"}</h2></div></div>
          {feedback ? <><p className={styles.help}>训练估分，非官方 IELTS 成绩 · {feedback.provider}</p>{feedback.evaluatedEssay !== draft.essay && <p className={styles.notice}>作文已有修改；以下反馈对应上次提交的文本。</p>}<DraftFeedback feedback={feedback} taskType={draft.taskType} /></> : <div className={ui.empty}>先完成草稿，再请求 AI 反馈。这里仅显示实际 AI 返回的四项评估，不会根据字数模拟分数。</div>}
        </section>
        <section className={ui.panel}><p className={ui.eyebrow}>Revision loop</p><h2>保留原稿，创建改写</h2><p>每个版本独立保存；依据反馈逐项修改，再检查论证、词汇与语法是否改善。</p>
          <button className={ui.buttonSecondary} disabled={busy || !ready || !draft.essay.trim()} onClick={() => void newRevision()}>创建 Draft {Math.max(draft.version, ...samePrompt.map((item) => item.version)) + 1}</button>
          <div className={styles.history}>{samePrompt.map((item) => <button key={item.id} className={item.id === draft.id ? styles.selectedHistory : ""} disabled={busy} onClick={() => void switchDraft(item)}><span>Draft {item.version} · {countWritingWords(item.essay)} words</span><small>{item.feedback ? `AI Estimated Band ${item.feedback.overallBand.toFixed(1)}` : "未评分"}</small></button>)}</div>
          {samePrompt.length > 1 && <label className={styles.importLabel}>Compare · 与历史版本对比<select value={compareId} onChange={(event) => setCompareId(event.target.value)}><option value="">选择历史版本</option>{samePrompt.filter((item) => item.id !== draft.id).map((item) => <option key={item.id} value={item.id}>Draft {item.version}</option>)}</select></label>}
        </section>
      </aside>
    </div>
    {compared && <section className={`${ui.panel} ${styles.comparePanel}`}><h2>Compare · 改写对比</h2><div className={styles.compareGrid}><div><h3>Draft {compared.version} · {countWritingWords(compared.essay)} words</h3><p>{compared.essay}</p></div><div><h3>Draft {draft.version} · {wordCount} words</h3><p>{draft.essay}</p></div></div></section>}
  </div>;
}
