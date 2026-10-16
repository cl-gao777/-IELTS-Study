"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import type { PracticeQuestion, PracticeSet } from "@/lib/domain";
import type { OfficialDocument } from "@/lib/official-resources";
import { defaultMockPaper, mockPaperDescription, type MockState } from "@/lib/mock-exam";
import { MockExamClient } from "@/lib/mock-exam-client";
import { exportRecoveryCopy, useDataEpochGuard } from "@/lib/data-epoch-client";
import { ContinuousPdf } from "./continuous-pdf";
import ui from "./page-ui.module.css";
import styles from "./mock-exam.module.css";

const cacheKey = "ielts-studio-mock-recovery:v5";
function stopAudio() { window.speechSynthesis?.cancel(); document.querySelectorAll("audio").forEach((element) => element.pause()); }
function makeClient() {
  let id = "";
  return new MockExamClient({
    get writerId() { if (!id) id = crypto.randomUUID(); return id; },
    async request(url, body, keepalive) {
      const response = await fetch(url, { ...(body === undefined ? { cache: "no-store" as const } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), keepalive }) });
      return { ok: response.ok, status: response.status, payload: await response.json() };
    },
    read() { return JSON.parse(localStorage.getItem(cacheKey) || "null"); },
    write(value) { localStorage.setItem(cacheKey, JSON.stringify(value)); },
  });
}
function formatTime(seconds: number) { return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }
function QuestionSheet({ questions, answers, onAnswer, disabled }: { questions: PracticeQuestion[]; answers: Record<string, string>; onAnswer(id: string, value: string): void; disabled: boolean }) {
  return <div className={styles.mockQuestions}>{questions.map((q, index) => <fieldset key={q.id} disabled={disabled}><legend>{q.originalQuestionNumber ?? index + 1}. {q.prompt}</legend>
    <p>{q.kind}{q.maxWords ? ` · NO MORE THAN ${q.maxWords} WORDS` : ""}</p>
    {q.options?.length ? <select className={ui.select} aria-label={`第 ${q.originalQuestionNumber ?? index + 1} 题`} value={answers[q.id] ?? ""} onChange={(event) => onAnswer(q.id, event.target.value)}><option value="">请选择…</option>{q.options.map((option) => <option key={option}>{option}</option>)}</select> : <input className={ui.input} aria-label={`第 ${q.originalQuestionNumber ?? index + 1} 题`} autoComplete="off" spellCheck={false} value={answers[q.id] ?? ""} onChange={(event) => onAnswer(q.id, event.target.value)} />}
  </fieldset>)}</div>;
}
function MockPdf({ documents, scrollRoot, zoom, headingLabel, onLayoutReady }: { documents: OfficialDocument[]; scrollRoot: RefObject<HTMLElement | null>; zoom: number; headingLabel: string; onLayoutReady(): void }) {
  const [ranges, setRanges] = useState<(OfficialDocument & { page: number; endPage: number })[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all(documents.map(async (document) => {
      if (document.endPage) return { ...document, page: document.page ?? 1, endPage: document.endPage };
      const response = await fetch(document.url + "/preview?metadata=1", { signal: controller.signal });
      const result = await response.json(); if (!response.ok || !Number.isInteger(result.total)) throw new Error("无法读取试卷页数，请重试。");
      return { ...document, page: document.page ?? 1, endPage: result.total as number };
    })).then((ranges) => { if (!controller.signal.aborted) { setRanges(ranges); setError(""); } }).catch((error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [documents, attempt]);
  if (error) return <p role="alert">{error}<button type="button" className={ui.buttonGhost} onClick={() => setAttempt(attempt + 1)}>重试试卷</button></p>;
  if (!ranges) return <p role="status">正在准备试卷 PDF…</p>;
  return <ContinuousPdf documents={ranges} scrollRoot={scrollRoot} zoom={zoom} headingLabel={headingLabel} onLayoutReady={onLayoutReady} />;
}
export function MockExam({ listeningSets, readingSets }: { listeningSets: PracticeSet[]; readingSets: PracticeSet[] }) {
  const [client] = useState(makeClient);
  const view = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  const [listeningId, setListeningId] = useState(() => defaultMockPaper(listeningSets, "listening"));
  const [readingId, setReadingId] = useState(() => defaultMockPaper(readingSets, "reading"));
  const [audioError, setAudioError] = useState("");
  const sourcePanel = useRef<HTMLElement>(null), answerPanel = useRef<HTMLElement>(null), audio = useRef<HTMLAudioElement>(null);
  const restoringScroll = useRef(false);
  const guard = useDataEpochGuard(() => client.freeze());
  useEffect(() => { void client.initialize(); }, [client]);
  useEffect(() => {
    const visibility = () => { if (document.hidden) { stopAudio(); void client.pause(true); } };
    const pagehide = () => { stopAudio(); void client.pause(true); };
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", pagehide); window.addEventListener("blur", pagehide);
    let previous = performance.now();
    const tick = window.setInterval(() => {
      const now = performance.now();
      if (document.hidden || client.getSnapshot().state?.paused || !client.getSnapshot().writer || client.getSnapshot().busy) { previous = now; return; }
      const seconds = Math.min(2, Math.floor((now - previous) / 1000));
      if (seconds > 0) { previous += seconds * 1000; if (!document.hidden) client.tick(seconds); }
    }, 1000);
    const save = window.setInterval(() => { if (client.getSnapshot().writer && !client.getSnapshot().busy && !client.getSnapshot().pendingSubmission) void client.checkpoint(); }, 3000);
    return () => { window.clearInterval(tick); window.clearInterval(save); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", pagehide); window.removeEventListener("blur", pagehide); stopAudio(); void client.pause(true); };
  }, [client]);
  useEffect(() => { if (view.state?.paused || view.frozen || guard.frozen) stopAudio(); }, [view.state?.paused, view.frozen, guard.frozen]);
  const session = view.session, state = view.state;
  const stage = state?.stage;
  const set = stage === "reading" ? session?.readingSet : session?.listeningSet;
  const passages = stage === "reading" ? set?.resource?.readingPassages : undefined;
  const passage = passages?.find((p) => p.id === state?.passageId) ?? passages?.[0];
  const positionKey = stage === "reading" ? passage?.id ?? "reading" : "listening";
  const restoreScroll = useCallback(() => {
    const current = client.getSnapshot().state;
    if (sourcePanel.current) sourcePanel.current.scrollTop = current?.positions[positionKey + ":source"] ?? 0;
    if (answerPanel.current) answerPanel.current.scrollTop = current?.positions[positionKey + ":answers"] ?? 0;
  }, [client, positionKey]);
  const hasPdf = Boolean(passage?.documents.length || set?.resource?.questionDocuments.length);
  useLayoutEffect(() => { restoringScroll.current = hasPdf; restoreScroll(); }, [restoreScroll, session?.id, view.loading, hasPdf]);
  const pdfLayoutReady = useCallback(() => { restoreScroll(); requestAnimationFrame(() => { restoringScroll.current = false; }); }, [restoreScroll]);
  const disabled = !view.writer || !!state?.paused || view.busy || view.pendingSubmission || view.frozen || guard.frozen;
  function change(update: Partial<MockState>) { client.change(update); }
  function rememberScroll(side: string, element: HTMLElement) { if (restoringScroll.current) return; const current = client.getSnapshot().state; if (current) change({ positions: { ...current.positions, [positionKey + ":" + side]: element.scrollTop } }); }
  function playSample() {
    if (disabled || !session?.listeningSet.transcript) return;
    stopAudio(); setAudioError("");
    const utterance = new SpeechSynthesisUtterance(session.listeningSet.transcript); utterance.lang = "en-GB"; utterance.rate = 0.94;
    utterance.onerror = () => setAudioError("语音播放失败，请检查浏览器声音设置并重试。"); window.speechSynthesis.speak(utterance);
  }
  if (view.loading) return <p role="status">正在核对考试草稿…</p>;
  const recovery = (view.frozen || guard.frozen) && <section className={ui.error} role="alert"><p>此页面已冻结。未保存内容仍在本页，不能继续回写。</p><button className={ui.buttonSecondary} type="button" onClick={() => exportRecoveryCopy("mock-recovery.json", view)}>导出未保存内容</button><button className={ui.buttonGhost} type="button" onClick={() => location.reload()}>刷新页面</button></section>;
  if (!session) return <div className={ui.page}><header className={ui.pageHeader}><div><p className={ui.eyebrow}>Listening → Reading → Writing</p><h1>模拟考试</h1><p>选择试卷；离开或切到后台会暂停，回来后手动继续。完成部分后不能返回修改。</p></div></header>
    {recovery}{view.error && <p className={ui.error}>{view.error}</p>}<section className={ui.panel}><label className={ui.field}>听力卷<select className={ui.select} value={listeningId} disabled={view.busy || view.frozen} onChange={(e) => setListeningId(e.target.value)}>{listeningSets.map((s) => <option value={s.id} key={s.id}>{s.title} — {mockPaperDescription(s)}</option>)}</select></label>
    <label className={ui.field}>阅读卷<select className={ui.select} value={readingId} disabled={view.busy || view.frozen} onChange={(e) => setReadingId(e.target.value)}>{readingSets.map((s) => <option value={s.id} key={s.id}>{s.title} — {mockPaperDescription(s)}</option>)}</select></label>
    <p>短卷或缺题卷只统计实际题数；不作为完整 IELTS 成绩。没有 AI 时作文照常保存，标为未评估。</p><button type="button" className={ui.button} disabled={!listeningId || !readingId || view.busy || view.frozen} onClick={() => void client.start(listeningId, readingId)}>开始新一轮</button></section></div>;
  if (session.status === "completed" && session.result) {
    const result = session.result;
    return <div className={ui.page}>{recovery}<header className={ui.pageHeader}><h1>模拟考试已保存</h1></header><section className={ui.panel}><p>Listening {result.listening.rawScore}/{result.listening.totalQuestions}</p><p>Reading {result.reading.rawScore}/{result.reading.totalQuestions}</p><p>Writing {result.provider === "local-fallback" ? "未评估 · 作文已保存" : `AI 估分 ${result.writing.overallBand.toFixed(1)}`}</p><ul>{result.writing.improvements.map((item) => <li key={item}>{item}</li>)}</ul><Link className={ui.buttonGhost} href="/writing">查看作文</Link><Link className={ui.buttonGhost} href="/review">复习错题</Link><button className={ui.button} type="button" disabled={view.frozen} onClick={() => void client.end()}>重新练习</button></section></div>;
  }
  if (!state || !set) return <p>考试状态不可用，请刷新页面。</p>;
  const questions = set.questions.filter((q) => !passage || passage.questionIds.includes(q.id));
  const documents = passage?.documents ?? set.resource?.questionDocuments;
  const tracks = session.listeningSet.resource?.audioTracks ?? (session.listeningSet.audioUrl ? [{ label: "听力音频", url: session.listeningSet.audioUrl, sourceUrl: "" }] : []);
  const track = tracks[state.audioTrack] ?? tracks[0];
  const zoom = state.zooms[positionKey] ?? 100;
  return <div className={styles.examRoom}>
    <header className={styles.examToolbar}><div><strong>模拟考试</strong><small>{stage} · {state.paused ? "已暂停" : view.writer ? "进行中" : "只读"}</small></div><nav>{["listening", "reading", "writing"].map((name) => <span key={name} data-state={name === stage ? "current" : "future"}>{name}</span>)}</nav><time>{formatTime(state.durations[state.stage])}</time></header>
    {recovery}{view.error && <p className={ui.error} role="alert">{view.error}</p>}
    <div className={styles.sessionActions}>{state.paused && !view.frozen ? <button type="button" className={ui.button} disabled={view.busy} onClick={() => void client.resume()}>继续本轮</button> : <button type="button" className={ui.buttonGhost} disabled={disabled} onClick={() => { stopAudio(); void client.pause(); }}>暂停</button>}
    <button type="button" className={ui.buttonGhost} onClick={() => exportRecoveryCopy("mock-draft.json", view)}>导出草稿</button>{view.pendingSubmission && <button type="button" className={ui.buttonGhost} disabled={view.busy || view.frozen} onClick={() => void client.submit()}>查询 / 重试原提交</button>}</div>
    {!view.pendingSubmission && <button type="button" className={ui.buttonGhost} disabled={view.busy || view.frozen} onClick={() => { if (window.confirm("结束当前轮并返回选卷？本轮不评分；现有草稿仍保留在会话记录中。")) { stopAudio(); void client.end(); } }}>结束本轮并返回选卷</button>}
    {stage !== "writing" ? <>
      {passages && <nav className={styles.passageTabs}>{passages.map((p, i) => <button className={p.id === passage?.id ? ui.button : ui.buttonGhost} type="button" key={p.id} disabled={disabled} onClick={() => change({ passageId: p.id })}>Passage {i + 1} · {p.questionIds.filter((id) => state.readingAnswers[id]?.trim()).length}/{p.questionIds.length}</button>)}</nav>}
      <div className={styles.mockSplit}><section ref={sourcePanel} className={`${ui.panel} ${styles.mockScroll}`} onScroll={(event) => rememberScroll("source", event.currentTarget)}>
        <h1>{passage?.label ?? set.title}</h1>
        {stage === "listening" && <div className={styles.audioBox}>{track ? <><label>音频<select className={ui.select} disabled={disabled} value={state.audioTrack} onChange={(e) => { stopAudio(); change({ audioTrack: Number(e.target.value), audioPosition: 0 }); }}>{tracks.map((t, i) => <option key={t.url + i} value={i}>{t.label}</option>)}</select></label>
        <audio ref={audio} key={track.url} controls src={track.url} onLoadedMetadata={(e) => { e.currentTarget.currentTime = client.getSnapshot().state?.audioPosition ?? 0; }} onPlay={(e) => { if (disabled) e.currentTarget.pause(); }} onTimeUpdate={(e) => change({ audioPosition: e.currentTarget.currentTime })} onError={() => setAudioError("音频加载或播放失败，请检查本地附件，重试不会丢失答案。")}/></> : session.listeningSet.transcript ? <button className={ui.button} disabled={disabled} type="button" onClick={playSample}>播放原创样卷语音</button> : <p className={ui.notice}>此卷未附可播放音频，可暂停并更换试卷。</p>}{audioError && <p role="alert">{audioError}</p>}</div>}
        {documents?.length ? <><label>缩放<select className={ui.select} value={zoom} disabled={disabled} onChange={(e) => change({ zooms: { ...state.zooms, [positionKey]: Number(e.target.value) } })}>{[100,125,150,200].map((n) => <option value={n} key={n}>{n === 100 ? "适应宽度" : n + "%"}</option>)}</select></label><MockPdf key={positionKey} documents={documents} scrollRoot={sourcePanel} zoom={zoom} headingLabel={passage?.label ?? set.title} onLayoutReady={pdfLayoutReady}/></> : stage === "reading" ? set.passage.split("\n\n").map((text, i) => <p className={styles.mockPassage} key={i}>{text}</p>) : <p>阅读右侧题目后播放声音；考试中不展示听力原文。</p>}
      </section><section ref={answerPanel} className={`${ui.panel} ${styles.mockScroll}`} onScroll={(event) => rememberScroll("answers", event.currentTarget)}><h2>Answer Sheet · {set.questions.filter((q) => (stage === "reading" ? state.readingAnswers : state.listeningAnswers)[q.id]?.trim()).length}/{set.questions.length}</h2><QuestionSheet questions={questions} disabled={disabled} answers={stage === "reading" ? state.readingAnswers : state.listeningAnswers} onAnswer={(id, answer) => change(stage === "reading" ? { readingAnswers: { ...state.readingAnswers, [id]: answer } } : { listeningAnswers: { ...state.listeningAnswers, [id]: answer } })}/><button className={ui.button} type="button" disabled={disabled} onClick={() => { stopAudio(); void client.nextStage(); }}>完成此部分并继续</button></section></div>
    </> : <section className={`${ui.panel} ${styles.writingExam}`}><div><p className={ui.eyebrow}>Writing Task 2</p><h1>{session.writingPrompt}</h1><p>Write at least 250 words.</p><span>{state.essay.trim().split(/\s+/).filter(Boolean).length} words</span></div><textarea disabled={disabled} value={state.essay} onChange={(event) => change({ essay: event.target.value })} placeholder="Write your essay…"/><button className={ui.button} type="button" disabled={disabled || state.essay.trim().length < 40} onClick={() => { stopAudio(); void client.submit(); }}>{view.busy ? "正在保存…" : "完成并提交整卷"}</button></section>}
    <p className={styles.saveHint}>浏览器即时保留草稿，服务器每 3 秒保存检查点。{!view.writer && !state.paused ? "另一页面正在编辑，本页只读。" : ""}</p>
  </div>;
}
