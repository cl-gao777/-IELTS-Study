"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { VocabularyAssessmentClient } from "@/lib/vocabulary-assessment-client";
import type { VocabularyAssessmentBand } from "@/lib/vocabulary-assessment";
import ui from "./page-ui.module.css";
import styles from "./vocabulary.module.css";

const bands: Record<VocabularyAssessmentBand, string> = { "ngsl-1": "通用词 · 1–500", "ngsl-2": "通用词 · 501–1000", "ngsl-3": "通用词 · 1001–1500", "ngsl-4": "通用词 · 1501–2000", "ngsl-5": "通用词 · 2001 起", nawl: "学术词" };
export function VocabularyAssessmentPanel({ onClose, onRecommendation }: { onClose: () => void; onRecommendation: (courseId: string, startRank: number) => Promise<void> }) {
  const [client] = useState(() => new VocabularyAssessmentClient());
  const [initial] = useState(client.getSnapshot);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, () => initial);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [recommendationError, setRecommendationError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const compositionEndedAt = useRef<number | null>(null);
  useEffect(() => {
    let storage: Storage | undefined; try { storage = window.localStorage; } catch {}
    void client.initialize(storage);
    const flush = () => { void client.flush(); };
    window.addEventListener("pagehide", flush);
    return () => { flush(); client.dispose(); window.removeEventListener("pagehide", flush); };
  }, [client]);
  const assessment = state.assessment;
  const question = assessment?.questions[assessment.draft.currentIndex];
  const questionId = question?.id;
  const answer = question ? assessment?.draft.answers[question.id] ?? "" : "";
  useEffect(() => { if (assessment?.status === "active" && questionId) inputRef.current?.focus(); }, [assessment?.status, questionId]);
  const marked = assessment?.questions.filter((item) => Object.hasOwn(assessment.draft.answers, item.id)).length ?? 0;
  function advance(skip = false) {
    if (!assessment || !question || state.busy || (!skip && !answer.trim())) return;
    client.change({ id: question.id, value: skip ? "" : answer }, assessment.draft.currentIndex + 1);
  }
  async function close() { await client.flush(); onClose(); }
  async function applyRecommendation() {
    if (!assessment?.result || applying) return;
    setApplying(true); setRecommendationError("");
    try { await onRecommendation(assessment.result.recommendedCourseId, assessment.result.recommendedStartRank); setApplied(true); }
    catch (error) { setRecommendationError(error instanceof Error ? error.message : "建议课程尚未保存，请重试。"); }
    finally { setApplying(false); }
  }
  return <section className={`${ui.panel} ${styles.assessmentPanel}`} aria-label="可选词汇摸底" data-vocabulary-assessment>
    <div className={ui.panelHeader}><div><h2>30 题词汇摸底</h2><p>用语境填空了解起点。结果只用于课程建议，不改变任何词的复习进度。</p></div><button type="button" className={ui.buttonGhost} disabled={state.busy || applying} onClick={() => void close()}>返回课程</button></div>
    {state.message && <div role="alert" className={ui.notice}>{state.message}<button type="button" className={ui.buttonGhost} disabled={state.busy} onClick={() => void client.flush()}>重试保存草稿</button></div>}
    {recommendationError && <p className={ui.error} role="alert">{recommendationError}</p>}
    {!state.ready ? <div className={ui.empty}><p>正在读取摸底记录…</p><button type="button" className={ui.buttonSecondary} disabled={state.busy} onClick={() => void client.initialize()}>重试读取</button></div>
      : !assessment ? <div className={styles.front}><h3>可以直接学习，也可以先摸底</h3><p>每个空位都有该处中文释义；不会时跳过即可。中途退出会保留草稿。</p><button type="button" className={ui.button} disabled={state.busy} onClick={() => void client.start()}>开始 30 题摸底</button></div>
      : assessment.status === "completed" && assessment.result ? <div className={styles.assessmentResult}>
        <h3>本次填词答对 {assessment.result.correct} / {assessment.result.total}</h3><p>已作答 {assessment.result.answered} 题，跳过 {assessment.result.skipped} 题。小样本诊断不代表全部词汇量或已掌握程度。</p>
        <dl className={styles.bandResults}>{assessment.result.bands.map((band) => <div key={band.band}><dt>{bands[band.band]}</dt><dd>{band.correct} / {band.total}</dd></div>)}</dl>
        <p>建议从 <strong>{bands[assessment.result.startBand]}</strong> 开始。原有到期词仍会优先复习。</p><div className={styles.cardActions}><button type="button" className={ui.button} disabled={applying || applied} onClick={() => void applyRecommendation()}>{applying ? "正在保存课程…" : applied ? "建议课程已开启" : "采用建议课程"}</button><button type="button" className={ui.buttonSecondary} disabled={state.busy || applying} onClick={() => { setApplied(false); void client.start(); }}>重新摸底</button></div>
        <details className={styles.wordDetails}><summary>查看本次原始回答与答案</summary><ol className={styles.assessmentFeedback}>{assessment.result.feedback.map((item) => <li key={item.id}><p className={item.correct ? styles.correct : styles.wrong}>{item.correct ? "✓ 回答正确" : "✗ 未答对"} · 你的答案：{item.submitted || "跳过"}</p><p>{item.sentence}</p><small>接受答案：{item.acceptedAnswers.join(" / ")} · {item.source}</small></li>)}</ol></details>
      </div> : <>
        <div className={styles.assessmentProgress}><span>已填写或跳过 {marked} / {assessment.questions.length}</span><span role="status">{state.saving ? "正在保存…" : "草稿自动保存"}</span></div>
        <nav className={styles.questionNav} aria-label="摸底题号">{assessment.questions.map((item, index) => <button type="button" key={item.id} aria-label={`第 ${index + 1} 题${Object.hasOwn(assessment.draft.answers, item.id) ? "，已处理" : "，未处理"}`} aria-current={assessment.draft.currentIndex === index ? "step" : undefined} data-answered={Object.hasOwn(assessment.draft.answers, item.id)} disabled={state.busy} onClick={() => client.change(undefined, index)}>{index + 1}</button>)}</nav>
        {question ? <div className={styles.assessmentQuestion}><span className={styles.small}>第 {assessment.draft.currentIndex + 1} 题</span><blockquote className={styles.contextSentence}>{question.prompt}</blockquote><p className={styles.contextMeaning}><span>此处意思</span><strong>{question.meaningZh}</strong></p><label className={styles.answer}><span>填入英文单词或短语</span><input ref={inputRef} className={ui.input} value={answer} maxLength={2000} disabled={state.busy} onChange={(event) => client.change({ id: question.id, value: event.target.value })} onCompositionStart={() => { composing.current = true; compositionEndedAt.current = null; }} onCompositionEnd={(event) => { composing.current = false; compositionEndedAt.current = event.timeStamp; }} onKeyDown={(event) => { if (event.key === "Enter" && !composing.current && !(compositionEndedAt.current !== null && event.timeStamp - compositionEndedAt.current < 50) && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); advance(); } }} autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} /></label><div className={styles.cardActions}><button type="button" className={ui.button} disabled={state.busy || !answer.trim()} onClick={() => advance()}>保存并下一题</button><button type="button" className={ui.buttonSecondary} disabled={state.busy} onClick={() => advance(true)}>不会，跳过本题</button></div></div>
          : <div className={styles.front}><h3>{marked === assessment.questions.length ? "已完成全部题目" : `还有 ${assessment.questions.length - marked} 题未处理`}</h3><p>可点击题号修改答案。跳过的题目不会计为答对。</p></div>}
        <div className={styles.assessmentSubmit}><button type="button" className={ui.button} disabled={state.busy || marked !== assessment.questions.length} onClick={() => void client.submit()}>{state.busy ? "正在核对…" : "提交摸底，查看建议"}</button><span className={styles.small}>30 题都填写或跳过后可提交。</span></div>
      </>}
  </section>;
}
