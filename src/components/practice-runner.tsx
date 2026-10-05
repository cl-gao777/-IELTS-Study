"use client";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PracticeAttempt, PracticeSet } from "@/lib/domain";
import { QUESTION_TYPES, MISTAKE_REASONS, questionOptions } from "@/lib/question-types";
import { emptyPracticeDraft, type PassageAnnotation, type PracticeWorkspaceState } from "@/lib/learning-workspace";
import type { DictationToken } from "@/lib/dictation";
import { ListeningPlayer } from "./listening-player";
import { OfficialPaper } from "./official-paper";
import { ReadingPaper } from "./reading-paper";
import ui from "./page-ui.module.css";
import styles from "./practice.module.css";

function formatTime(seconds: number) { return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0"); }
const errorLabels = { missing: "漏词", extra: "多词", wrong: "错词", spelling: "疑似拼写", correct: "正确" };
export function PracticeRunner({ set, initialState }: { set: PracticeSet; initialState?: PracticeWorkspaceState }) {
  const [draft, setDraft] = useState(initialState?.draft || { ...emptyPracticeDraft });
  const [annotations, setAnnotations] = useState<PassageAnnotation[]>(initialState?.annotations || []);
  const [elapsed, setElapsed] = useState(initialState?.draft.elapsed || 0);
  const elapsedRef = useRef(initialState?.draft.elapsed || 0);
  const [attempt, setAttempt] = useState<PracticeAttempt | null>(initialState?.draft.isRetry ? null : initialState?.attempt || null);
  const [reasons, setReasons] = useState(initialState?.reasons || {});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [saveStatus, setSaveStatus] = useState("已载入本地记录");
  const [selection, setSelection] = useState<{ start: number; end: number; text: string } | null>(null);
  const [evidence, setEvidence] = useState("");
  const [showTranscript, setShowTranscript] = useState(false);
  const [activeQuestion, setActiveQuestion] = useState(0);
  const [activePassageId, setActivePassageId] = useState(set.resource?.readingPassages?.[0]?.id || "");
  const [dictationResult, setDictationResult] = useState<DictationToken[] | null>(null);
  const [audioRange, setAudioRange] = useState<{ startSeconds?: number; endSeconds?: number }>({});
  const root = useRef<HTMLDivElement>(null);
  const source = useRef<HTMLDivElement>(null);
  const sourcePanel = useRef<HTMLElement>(null);
  const questionPanel = useRef<HTMLElement>(null);
  const passagePositions = useRef(new Map<string, { left: number; right: number; question: number }>());
  const restoredPdfPassage = useRef<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const saveSequence = useRef(Promise.resolve());
  const isReading = set.kind === "reading";
  const canEstimateBand = set.questions.length === 40 && set.resource?.bandEstimateAllowed !== false;
  const sourceText = isReading ? set.passage : set.transcript;
  const answers = useMemo(() => attempt ? { ...draft.answers, ...Object.fromEntries(attempt.answers.map((answer) => [answer.questionId, answer.submitted])) } : draft.answers, [draft.answers, attempt]);
  const passages = isReading ? set.resource?.readingPassages : undefined;
  const currentPassage = passages?.find((passage) => passage.id === activePassageId) || passages?.[0];
  const visibleQuestions = useMemo(() => set.questions.map((question, index) => ({ question, index }))
    .filter(({ question }) => !currentPassage || currentPassage.questionIds.includes(question.id)), [set.questions, currentPassage]);
  const answeredCount = set.questions.filter((question) => answers[question.id]?.trim()).length;
  const passageAnsweredCount = visibleQuestions.filter(({ question }) => answers[question.id]?.trim()).length;
  const restoreReadingScroll = useCallback(() => {
    if (!currentPassage) return;
    const position = passagePositions.current.get(currentPassage.id);
    if (sourcePanel.current) sourcePanel.current.scrollTop = position?.left || 0;
    if (questionPanel.current) questionPanel.current.scrollTop = position?.right || 0;
  }, [currentPassage]);
  useLayoutEffect(() => {
    restoredPdfPassage.current = null;
    restoreReadingScroll();
  }, [restoreReadingScroll]);
  const restorePdfScroll = useCallback(() => {
    if (!currentPassage || restoredPdfPassage.current === currentPassage.id) return;
    const panel = sourcePanel.current;
    if (panel?.querySelector<HTMLElement>("[data-reading-passage]")?.dataset.readingPassage !== currentPassage.id) return;
    restoredPdfPassage.current = currentPassage.id;
    const position = passagePositions.current.get(currentPassage.id);
    if (position) panel.scrollTop = position.left;
  }, [currentPassage]);
  function switchPassage(id: string) {
    if (!currentPassage || id === currentPassage.id) return;
    passagePositions.current.set(currentPassage.id, { left: sourcePanel.current?.scrollTop || 0, right: questionPanel.current?.scrollTop || 0, question: activeQuestion });
    const next = passages?.find((passage) => passage.id === id);
    if (!next) return;
    setActivePassageId(id);
    const previousQuestion = passagePositions.current.get(id)?.question;
    setActiveQuestion(previousQuestion !== undefined && next.questionIds.includes(set.questions[previousQuestion]?.id)
      ? previousQuestion : Math.max(0, set.questions.findIndex((question) => next.questionIds.includes(question.id))));
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void root.current?.requestFullscreen().catch(() => setMessage("此浏览器暂不支持全屏。"));
  }
  const patchDraft = (patch: Partial<typeof draft>) => { setDraft((current) => ({ ...current, ...patch })); setSaveStatus("正在保存…"); };
  const save = useCallback(() => {
    const body = JSON.stringify({ draft: { ...draft, elapsed: elapsedRef.current }, annotations });
    saveSequence.current = saveSequence.current.catch(() => undefined).then(async () => {
      try {
        const response = await fetch("/api/practice/workspace/" + encodeURIComponent(set.id), { method: "PUT", headers: { "Content-Type": "application/json" }, body, keepalive: body.length < 50000 });
        if (!response.ok) throw new Error("保存失败");
        setSaveStatus("已保存到本地 SQLite");
      } catch { setSaveStatus("保存失败：输入仍在页面，请重试"); }
    });
    return saveSequence.current;
  }, [draft, annotations, set.id]);
  const latestSave = useRef(save);
  useEffect(() => { latestSave.current = save; }, [save]);
  useEffect(() => () => { void latestSave.current(); }, []);
  useEffect(() => {
    if (attempt) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) { elapsedRef.current += 1; setElapsed(elapsedRef.current); }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [attempt]);
  useEffect(() => { const timer = window.setTimeout(() => { void save(); }, 650); return () => window.clearTimeout(timer); }, [save]);
  useEffect(() => {
    const timer = window.setInterval(() => { void save(); }, 15000);
    const leaving = () => { void save(); };
    window.addEventListener("pagehide", leaving);
    return () => { window.clearInterval(timer); window.removeEventListener("pagehide", leaving); };
  }, [save]);
  const navigate = useCallback((index: number) => {
    if (!visibleQuestions.length) return;
    const next = visibleQuestions.reduce((nearest, item) => Math.abs(item.index - index) < Math.abs(nearest - index) ? item.index : nearest, visibleQuestions[0].index);
    setActiveQuestion(next);
    const target = document.getElementById("question-" + next);
    const panel = questionPanel.current;
    if (isReading && target && panel) {
      const headerHeight = panel.querySelector<HTMLElement>("[data-answer-header]")?.offsetHeight || 0;
      panel.scrollTo({ top: target.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop - headerHeight - 16, behavior: "smooth" });
    } else target?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [visibleQuestions, isReading]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement;
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); if (!attempt && set.questions.length) form.current?.requestSubmit(); return; }
      if (/INPUT|TEXTAREA|SELECT|BUTTON/.test(element.tagName) || element.isContentEditable || event.ctrlKey || event.metaKey || event.altKey) return;
      const direction = event.key.toLowerCase() === "n" ? 1 : event.key.toLowerCase() === "p" ? -1 : 0;
      if (direction && visibleQuestions.length) {
        const position = Math.max(0, visibleQuestions.findIndex(({ index }) => index === activeQuestion));
        navigate(visibleQuestions[Math.max(0, Math.min(visibleQuestions.length - 1, position + direction))].index);
      }
    };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, [attempt, activeQuestion, navigate, set.questions.length, visibleQuestions]);
  function captureSelection() {
    const selected = window.getSelection(); if (!selected?.rangeCount || !source.current) return;
    const range = selected.getRangeAt(0);
    if (!source.current.contains(range.commonAncestorContainer) || !selected.toString().trim()) return;
    const preceding = range.cloneRange(); preceding.selectNodeContents(source.current); preceding.setEnd(range.startContainer, range.startOffset);
    const start = preceding.toString().length; setSelection({ start, end: start + range.toString().length, text: range.toString() });
  }
  function annotate(style: "highlight" | "underline") {
    if (!selection) { setMessage("先在原文中选中要标注的文本。"); return; }
    setAnnotations((current) => [...current, { id: crypto.randomUUID(), start: selection.start, end: selection.end, style, note: "" }]); setSelection(null); setSaveStatus("正在保存…");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || attempt || !set.questions.length) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/practice/attempts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ setId: set.id, answers, durationSeconds: elapsedRef.current }) });
      const payload = await response.json(); if (!response.ok || !payload.attempt) throw new Error(payload.error || "评分失败");
      setAttempt(payload.attempt); patchDraft({ isRetry: false }); setMessage("已评分并保存。错误答案已加入 Mistakes；可在下方记录错误原因。"); window.speechSynthesis?.cancel();
    } catch (error) { setMessage(error instanceof Error ? error.message : "无法连接本地服务器，答案已保留，请重试。"); }
    finally { setBusy(false); }
  }
  async function classify(questionId: string, reason: string) {
    if (!attempt || !reason) return;
    try {
      const response = await fetch("/api/practice/mistake-reason", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attemptId: attempt.id, questionId, reason }) });
      if (!response.ok) throw new Error(); setReasons((current) => ({ ...current, [questionId]: reason })); setMessage("错误原因已保存。");
    } catch { setMessage("错误原因保存失败，请重试。"); }
  }
  async function dictation() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/practice/dictation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ setId: set.id, expected: draft.dictationReference, submitted: draft.dictationText, ...audioRange }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "听写保存失败");
      setDictationResult(payload.tokens); setMessage("听写已保存：" + payload.errorCount + " 处差异，错误已进入 Mistakes。拼写分类使用字符相似度判断。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "无法连接本地服务器，听写文本已保留。"); }
    finally { setBusy(false); }
  }
  function findEvidence(text: string) {
    if (!text) { setMessage("该题未提供逐字证据，请结合解析定位；可在资料中录入证据。"); return; }
    setEvidence(text); setShowTranscript(true);
    window.setTimeout(() => source.current?.querySelector("[data-evidence]")?.scrollIntoView({ behavior: "smooth", block: "center" }), 40);
    if (!sourceText.toLowerCase().includes(text.toLowerCase())) setMessage("参考证据未与原文逐字匹配，请阅读题目下方的证据文本。");
  }
  return <div className={ui.page + " " + styles.workspace + (isReading ? " " + styles.readingWorkspace : "")} ref={root} data-source-material={set.title} data-study-area={isReading ? "Reading" : "Listening"}>
    <div className={isReading ? styles.readingTop : undefined}>
    {isReading ? <>
      <header className={styles.readingHeader}>
        <div className={styles.readingHeading}><Link href="/practice/reading" className={styles.sourceLink}>← 阅读题库</Link><h1 title={set.title}>{set.title}</h1></div>
        <div className={styles.readingTimer}><small>{attempt ? "已提交" : "练习用时"}</small><strong>{formatTime(elapsed)}</strong><small>建议 {set.durationMinutes} 分钟</small></div>
        <span className={styles.overallProgress} aria-label="整卷答题进度">整卷 {answeredCount}/{set.questions.length} 已答</span>
        {!attempt && set.questions.length > 0 && <button className={ui.button} type="submit" form="practice-answers" disabled={busy}>{busy ? "正在评分…" : "提交整套卷"}</button>}
      </header>
      <div className={styles.readingControls}>
        {passages && passages.length > 1 ? <nav className={styles.passageTabs} aria-label="阅读篇章">{passages.map((passage, index) => <button type="button" key={passage.id} aria-pressed={passage.id === currentPassage?.id} className={passage.id === currentPassage?.id ? ui.button : ui.buttonSecondary} onClick={() => switchPassage(passage.id)}>Passage {index + 1}<small>{passage.questionIds.filter((id) => answers[id]?.trim()).length}/{passage.questionIds.length}</small></button>)}</nav> : <span className={styles.singlePassage}>单篇阅读练习</span>}
        <div className={styles.readingActions}>{!set.resource && <label>字号<select className={ui.select} value={draft.fontSize} onChange={(event) => patchDraft({ fontSize: Number(event.target.value) })}>{[14, 16, 17, 18, 20, 22, 24, 26].map((size) => <option key={size}>{size}</option>)}</select></label>}<details className={styles.practiceInstructions}><summary>练习说明</summary><p>{set.instructions}</p></details><button className={ui.buttonGhost} type="button" onClick={toggleFullscreen}>全屏</button><button className={ui.buttonGhost} type="button" onClick={() => void save()}>保存笔记</button><span className={styles.saveStatus} role="status">{saveStatus}</span></div>
      </div>
    </> : <>
      <header className={ui.pageHeader + " " + styles.examHeader}><div><p className={ui.eyebrow}>Listening · {set.subtitle}</p><h1>{set.title}</h1><p>{set.instructions}</p></div><div className={styles.timer}><small>{attempt ? "已提交" : "练习用时"}</small><strong>{formatTime(elapsed)}</strong><small>建议 {set.durationMinutes} 分钟</small></div></header>
      <div className={styles.toolbar}><Link className={ui.buttonGhost} href="/practice/listening">练习列表</Link><Link className={ui.buttonGhost} href="/materials">导入 / 管理资料</Link>{!set.resource && <label>字号 <select className={ui.select} value={draft.fontSize} onChange={(event) => patchDraft({ fontSize: Number(event.target.value) })}>{[14, 16, 17, 18, 20, 22, 24, 26].map((size) => <option key={size}>{size}</option>)}</select></label>}<button className={ui.buttonGhost} type="button" onClick={toggleFullscreen}>全屏</button><span className={styles.saveStatus} role="status">{saveStatus}</span><button className={ui.buttonGhost} type="button" onClick={() => void save()}>保存笔记</button></div>
    </>}
    {message && <div className={ui.notice} role="status">{message}</div>}
    {attempt && <section className={styles.resultBar}><div><small>正确 / 总题数</small><strong>{attempt.rawScore} / {attempt.totalQuestions}</strong></div><div><small>错误</small><strong>{attempt.totalQuestions - attempt.rawScore}</strong></div><div><small>Estimated IELTS Band</small><strong>{canEstimateBand ? attempt.bandScore.toFixed(1) : "—"}</strong><small>{canEstimateBand ? "非官方评分" : "本练习不估分，以正确率为准"}</small></div><Link className={ui.buttonGhost} href="/review">查看错题</Link><button className={ui.buttonGhost} onClick={() => { setAttempt(null); elapsedRef.current = 0; setElapsed(0); patchDraft({ answers: {}, elapsed: 0, isRetry: true }); setReasons({}); }}>重新练习</button></section>}
    </div>
    <form id="practice-answers" ref={form} className={styles.practiceGrid + (isReading ? " " + styles.readingGrid : "")} onSubmit={submit}>
      <section ref={sourcePanel} className={ui.panel + " " + styles.sourcePanel} aria-label={isReading ? "阅读材料与题目" : "听力材料"} tabIndex={0}>
        {set.resource ? currentPassage ? <ReadingPaper resource={set.resource} passage={currentPassage} scrollRoot={sourcePanel} onLayoutReady={restorePdfScroll} /> : <OfficialPaper resource={set.resource} listening={!isReading} onRange={setAudioRange} /> : <>
          {!isReading && <ListeningPlayer audioUrl={set.audioUrl} transcript={set.transcript} onRange={setAudioRange} />}
          {(isReading || showTranscript) && <><div className={styles.paperTitle}><small>{isReading ? "Reading Passage" : "Transcript"}</small><strong>{set.title}</strong></div><div className={styles.toolbar}><button className={ui.buttonGhost} type="button" onClick={() => annotate("highlight")}>高亮</button><button className={ui.buttonGhost} type="button" onClick={() => annotate("underline")}>下划线</button>{selection && <small>已选：{selection.text.slice(0, 60)}</small>}</div><div ref={source} className={styles.passage} style={{ fontSize: draft.fontSize }} onMouseUp={captureSelection} onKeyUp={captureSelection}><AnnotatedText text={sourceText} annotations={annotations} evidence={evidence} /></div>{!sourceText && <p>此音频还没有 Transcript。到 Materials 打开该资料，粘贴并保存听力稿。</p>}</>}
          {!isReading && <button className={ui.buttonGhost} type="button" onClick={() => setShowTranscript(!showTranscript)}>{showTranscript ? "隐藏 Transcript" : "查看 Transcript"}</button>}
        </>}
        <details className={styles.notes} open={!set.questions.length}><summary>Notes · 阅读 / 听力笔记（自动保存）</summary><textarea className={ui.textarea} aria-label="学习笔记" value={draft.notes} onChange={(event) => patchDraft({ notes: event.target.value })} placeholder="记录同义替换、句子理解和疑问…" />{annotations.map((annotation) => <div key={annotation.id} className={styles.annotation}><blockquote>{sourceText.slice(annotation.start, annotation.end)}</blockquote><input className={ui.input} aria-label="标注备注" placeholder="给这处标注添加笔记…" value={annotation.note} onChange={(event) => setAnnotations((current) => current.map((item) => item.id === annotation.id ? { ...item, note: event.target.value } : item))} /><button className={ui.buttonGhost} type="button" onClick={() => setAnnotations((current) => current.filter((item) => item.id !== annotation.id))}>删除标注</button></div>)}</details>
      </section>
      <section ref={questionPanel} className={ui.panel + " " + styles.questionPanel} aria-label="答题卡" tabIndex={0}>
        {set.questions.length > 0 && <><div className={isReading ? styles.answerPanelHeader : undefined} data-answer-header><div className={ui.panelHeader}><h2>{set.resource ? "Answer Sheet · 答题卡" : "Questions · 题目"}</h2><span className={ui.pill}>{passageAnsweredCount}/{visibleQuestions.length} 已答</span></div><nav className={styles.questionNav} aria-label="题目导航">{visibleQuestions.map(({ question, index }) => <button key={question.id} type="button" className={answers[question.id]?.trim() ? styles.answered : ""} aria-current={activeQuestion === index ? "step" : undefined} onClick={() => navigate(index)}>{question.originalQuestionNumber ?? index + 1}</button>)}</nav><p className={isReading ? styles.answerHint : undefined}>{currentPassage ? "当前篇答题 · " : set.resource ? "按左侧 PDF 题号作答 · " : ""}N / P 切题 · Ctrl / Cmd + Enter 提交{isReading ? "整卷" : ""}</p></div><div className={styles.questions + (set.resource ? " " + styles.answerSheet : "")}>
          {visibleQuestions.map(({ question, index }) => { const detail = attempt?.answers.find((answer) => answer.questionId === question.id); const options = questionOptions(question); const descriptor = QUESTION_TYPES[question.kind]; return <fieldset id={"question-" + index} className={styles.question + " " + (detail ? detail.correct ? styles.correct : styles.incorrect : "")} key={question.id} onFocus={() => setActiveQuestion(index)}><legend><span>{question.originalQuestionNumber ?? index + 1}</span>{!set.resource && question.prompt}</legend><small className={styles.questionType}>{descriptor.label}{question.maxWords ? " · NO MORE THAN " + question.maxWords + " WORDS" : ""}{question.answerGroup && " · 同组顺序不限，须填不同答案"}</small>
            {question.imageUrl && <figure>{/* eslint-disable-next-line @next/next/no-img-element */}
<img className={styles.questionImage} src={question.imageUrl} alt="Map or diagram for this question" /></figure>}
            {options.length ? descriptor.mode === "matching" ? <select className={ui.select} value={answers[question.id] || detail?.submitted || ""} disabled={Boolean(attempt)} aria-label={"Question " + (question.originalQuestionNumber ?? index + 1)} onChange={(event) => patchDraft({ answers: { ...answers, [question.id]: event.target.value } })}><option value="">请选择匹配项…</option>{options.map((option) => <option key={option}>{option}</option>)}</select> : <div className={styles.options}>{options.map((option) => <label key={option}><input type="radio" name={question.id} value={option} checked={(answers[question.id] || detail?.submitted) === option} disabled={Boolean(attempt)} onChange={(event) => patchDraft({ answers: { ...answers, [question.id]: event.target.value } })} /><span>{option}</span></label>)}</div> : <input className={ui.input} aria-label={"Question " + (question.originalQuestionNumber ?? index + 1)} value={answers[question.id] ?? detail?.submitted ?? ""} disabled={Boolean(attempt)} onChange={(event) => patchDraft({ answers: { ...answers, [question.id]: event.target.value } })} placeholder="Type your answer" />}
            {detail && <div className={styles.evidence}><strong>{detail.correct ? "✓ Correct · 正确" : "✕ Wrong · 错误"}</strong><p>你的答案：{detail.submitted || "（未作答）"}</p><p>{question.answerGroup ? "同组正确选项（每个仅计一次）" : "正确答案"}：{detail.expected.join(" / ")}</p>{question.explanation && <p>{question.explanation}</p>}{question.evidence && <blockquote>{question.evidence}</blockquote>}{!set.resource && question.evidence && sourceText.toLowerCase().includes(question.evidence.toLowerCase()) ? <button className={ui.buttonGhost} type="button" onClick={() => findEvidence(question.evidence || "")}>Find Evidence · 定位证据</button> : <p>{set.resource ? "请结合左侧原版试卷与可展开的答案 PDF 核对；此题未提供可定位的逐字证据。" : "此题未提供可定位的逐字证据，请结合原文与解析核对。"}</p>}{!detail.correct && <label className={ui.field}>Mistake reason · 错误原因<select className={ui.select} value={reasons[question.id] || ""} onChange={(event) => classify(question.id, event.target.value)}><option value="">选择错误原因…</option>{MISTAKE_REASONS.map((reason) => <option key={reason}>{reason}</option>)}</select></label>}</div>}
          </fieldset>; })}
        </div>{!attempt && !isReading && <button className={ui.button} type="submit" disabled={busy}>{busy ? "正在评分…" : "提交答案并保存"}</button>}</>}
        {!isReading && <section className={styles.dictation}><h2>Dictation · 精听听写</h2><p>先听一个片段并输入，再展开参考文本。选择的参考文本应与 AB 片段一致，最多 500 个词。</p><label className={ui.field}>我听到的内容<textarea className={ui.textarea} value={draft.dictationText} onChange={(event) => { patchDraft({ dictationText: event.target.value }); setDictationResult(null); }} placeholder="Listen, then type here…" /></label><details><summary>设置参考 Transcript（核对时展开）</summary><label className={ui.field}>本次片段的准确原文<textarea className={ui.textarea} value={draft.dictationReference} onChange={(event) => { patchDraft({ dictationReference: event.target.value }); setDictationResult(null); }} /></label>{set.transcript && <button className={ui.buttonGhost} type="button" onClick={() => patchDraft({ dictationReference: set.transcript })}>使用全部 Transcript</button>}</details><button className={ui.button} type="button" disabled={busy || !draft.dictationReference.trim()} onClick={dictation}>核对并保存听写</button>{dictationResult && <div className={styles.dictationDiff}><p>漏词 · 多词 · 错词 · 疑似拼写</p>{dictationResult.map((token, index) => <span key={index} className={styles["diff_" + token.kind]} title={errorLabels[token.kind]}>{token.kind === "correct" ? token.expected : <>{token.actual && <del>{token.actual}</del>} {token.expected && <ins>{token.expected}</ins>}<small>{errorLabels[token.kind]}</small></>}</span>)}</div>}</section>}
        {isReading && !set.questions.length && <><h2>自由阅读</h2><p>选中左侧的英文词汇，可加入个人 Vocabulary。使用高亮、下划线和笔记记录阅读过程。</p><p>需要自动评分时，在 Materials 中为此资料添加 Questions + Answers，或配置 AI 生成题目。</p><Link className={ui.buttonGhost} href="/materials">返回资料库录入题目 →</Link></>}
      </section>
    </form>
  </div>;
}

function AnnotatedText({ text, annotations, evidence }: { text: string; annotations: PassageAnnotation[]; evidence: string }) {
  const start = evidence ? text.toLowerCase().indexOf(evidence.toLowerCase()) : -1;
  const points = new Set([0, text.length]);
  for (const annotation of annotations) { if (annotation.start >= 0 && annotation.end <= text.length) { points.add(annotation.start); points.add(annotation.end); } }
  if (start >= 0) { points.add(start); points.add(start + evidence.length); }
  const bounds = [...points].sort((a, b) => a - b);
  return bounds.slice(0, -1).map((position, index) => {
    const active = annotations.filter((annotation) => annotation.start <= position && annotation.end > position);
    const found = start >= 0 && position >= start && position < start + evidence.length;
    const marked = active.some((annotation) => annotation.style === "highlight");
    return <span key={position} data-evidence={found || undefined} title={active.map((annotation) => annotation.note).filter(Boolean).join("; ")} className={(found ? styles.foundEvidence : marked ? styles.highlight : "") + " " + (active.some((annotation) => annotation.style === "underline") ? styles.underlined : "")}>{text.slice(position, bounds[index + 1])}</span>;
  });
}
