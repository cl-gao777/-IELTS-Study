"use client";

import { useEffect, useRef, useState } from "react";
import type { ReviewRating } from "@/lib/srs";
import type { VocabularyReviewPreview } from "@/lib/vocabulary-scheduler";
import type { VocabularyCardDraft } from "@/lib/vocabulary-session";
import { isVocabularyTypoCandidate, normaliseVocabularyAnswer, type VocabularyEntry, type VocabularyReviewMode } from "@/lib/vocabulary";
import { playVocabularyAudio } from "@/lib/vocabulary-audio";
import { vocabularyIntervalLabel, vocabularyPracticeContext, vocabularyRecallCue } from "@/lib/vocabulary-practice";
import ui from "./page-ui.module.css";
import styles from "./vocabulary.module.css";

export const vocabularyModes: { value: VocabularyReviewMode; label: string; description: string }[] = [
  { value: "recognition", label: "Recognition · 认词", description: "看英文，先回忆释义，再显示答案。" },
  { value: "recall", label: "Recall · 回忆", description: "看释义，独立回忆并输入英文单词或短语。" },
  { value: "spelling", label: "Spelling · 听写", description: "听发音，输入英文单词或短语。" },
  { value: "context", label: "Context · 语境", description: "根据原句，填写空缺的单词或短语。" },
];
const ratings: { value: ReviewRating; label: string; description: string }[] = [
  { value: "again", label: "Again · 重学", description: "忘记或需要提示" },
  { value: "hard", label: "Hard · 困难", description: "努力后独立想起" },
  { value: "good", label: "Good · 记得", description: "正常独立想起" },
  { value: "easy", label: "Easy · 轻松", description: "迅速且熟练" },
];

export type VocabularyCardReview = {
  rating: ReviewRating;
  mode: VocabularyReviewMode;
  userAnswer: string;
  confirmedTypo: boolean;
  gaveUp: boolean;
  durationSeconds: number;
};

type PreviewSnapshot = { key: string; retry: number; preview: VocabularyReviewPreview | null; error: string };
function useReviewPreview(wordId: string, wordVersion: number, revealed: boolean) {
  const [snapshot, setSnapshot] = useState<PreviewSnapshot | null>(null);
  const [retry, setRetry] = useState(0);
  const key = wordId + ":" + wordVersion;
  useEffect(() => {
    if (!revealed) return;
    const controller = new AbortController();
    fetch(`/api/vocabulary/${encodeURIComponent(wordId)}/review`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as { preview?: VocabularyReviewPreview; error?: string };
        const preview = payload.preview;
        if (!response.ok || !preview) throw new Error(payload.error || "无法读取复习时间，请重试。");
        if (!Number.isInteger(preview.wordVersion) || preview.wordVersion < 1 || ratings.some((rating) => !Number.isFinite(preview.ratings?.[rating.value]?.intervalSeconds) || preview.ratings[rating.value].intervalSeconds < 0)) throw new Error("复习时间数据不完整，请重试。");
        if (!controller.signal.aborted) setSnapshot({ key, retry, preview, error: "" });
      }).catch((failure: unknown) => {
        if (!controller.signal.aborted) setSnapshot({ key, retry, preview: null, error: failure instanceof TypeError ? "复习时间暂时不可用，请恢复连接后重试。" : failure instanceof Error ? failure.message : "无法读取复习时间，请重试。" });
      });
    return () => controller.abort();
  }, [wordId, wordVersion, revealed, retry, key]);
  const current = snapshot?.key === key && snapshot.retry === retry ? snapshot : null;
  return { preview: current?.preview ?? null, error: current?.error ?? "", retry: () => setRetry((value) => value + 1) };
}

type AudioStatus = "idle" | "starting" | "playing";
function useCardAudio(identity: string) {
  const controller = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<AudioStatus>("idle");
  const [error, setError] = useState("");
  useEffect(() => () => controller.current?.abort(), [identity]);
  function cancel() { controller.current?.abort(); controller.current = null; setStatus("idle"); }
  function play(text: string, onComplete?: () => void) {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setError(""); setStatus("starting");
    void playVocabularyAudio(text, { signal: request.signal, onStart: () => { if (!request.signal.aborted) setStatus("playing"); } })
      .then(() => { if (controller.current === request && !request.signal.aborted) { setStatus("idle"); onComplete?.(); } })
      .catch((failure: unknown) => {
        if (controller.current !== request || request.signal.aborted) return;
        setStatus("idle"); setError(failure instanceof Error ? failure.message : "发音播放失败，请重试。");
      });
  }
  return { status, error, play, cancel };
}

export function VocabularyReviewCard({ word, mode, draft, busy, onDraftChange, onReview, onEdit, onSkip, onRefresh }: {
  word: VocabularyEntry;
  mode: VocabularyReviewMode;
  draft: VocabularyCardDraft;
  busy: boolean;
  onDraftChange: (patch: Partial<VocabularyCardDraft>) => void;
  onReview: (word: VocabularyEntry, input: VocabularyCardReview) => void;
  onEdit: () => void;
  onSkip: () => void;
  onRefresh: () => void;
}) {
  const revealed = draft.phase === "revealed";
  const inputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const compositionEndedAt = useRef<number | null>(null);
  const cue = vocabularyRecallCue(word);
  const context = vocabularyPracticeContext(word);
  const requiresTyping = mode !== "recognition";
  const correct = requiresTyping ? Boolean(draft.answer.trim()) && normaliseVocabularyAnswer(draft.answer) === normaliseVocabularyAnswer(word.term) : null;
  const cueReady = mode === "recall" ? Boolean(cue.title) : mode === "context" ? Boolean(context) : true;
  const audioReady = mode !== "spelling" || draft.audioPlayed;
  const { preview, error: previewError, retry: retryPreview } = useReviewPreview(word.id, draft.wordVersion, revealed);
  const versionChanged = word.id !== draft.wordId || word.reviewVersion !== draft.wordVersion || Boolean(preview && preview.wordVersion !== draft.wordVersion);
  const typoCandidate = requiresTyping && !draft.gaveUp && correct === false && isVocabularyTypoCandidate(draft.answer, word.term);
  const confirmedTypo = typoCandidate && draft.confirmedTypo;
  const needsRelearning = draft.gaveUp || (correct === false && !confirmedTypo);
  const ready = !versionChanged && cueReady && audioReady;
  const audio = useCardAudio(word.id + ":" + draft.wordVersion + ":" + mode);
  useEffect(() => { if (!revealed && requiresTyping) inputRef.current?.focus(); }, [word.id, mode, revealed, requiresTyping]);

  function reveal(gaveUp = false) {
    if (busy || revealed || !ready || (!gaveUp && requiresTyping && !draft.answer.trim())) return;
    audio.cancel();
    onDraftChange({ phase: "revealed", gaveUp, confirmedTypo: false });
  }
  function review(rating: ReviewRating, submittedAt: number) {
    if (busy || !revealed || !preview || !ready || (needsRelearning && rating !== "again")) return;
    const elapsed = (submittedAt - Date.parse(draft.startedAt)) / 1000;
    onReview(word, { rating, mode, userAnswer: draft.answer, confirmedTypo: draft.confirmedTypo, gaveUp: draft.gaveUp,
      durationSeconds: Number.isFinite(elapsed) ? Math.min(3600, Math.max(0, Math.round(elapsed))) : 0 });
  }
  function playPrompt() {
    if (audio.status === "playing") audio.cancel();
    else audio.play(word.term, () => onDraftChange({ audioPlayed: true }));
  }

  return <section className={`${ui.panel} ${styles.card}`} aria-label="当前词汇练习" data-vocabulary-card data-no-vocabulary>
    <div className={styles.cardHeader}><span>{vocabularyModes.find((item) => item.value === mode)?.description}</span>{revealed && <button type="button" className={ui.buttonGhost} disabled={busy} onClick={onEdit}>编辑词条</button>}</div>
    {versionChanged && <div className={ui.notice} role="alert"><p>词卡已更新，本次答案尚未评分。同步词卡后再继续。</p><button type="button" className={ui.buttonSecondary} disabled={busy} onClick={onRefresh}>同步词卡</button></div>}
    <div className={styles.front}>
      {mode === "recognition" && <><span>{word.ipa || word.pronunciation} {word.partOfSpeech}</span><h2>{word.term}</h2><button type="button" className={ui.buttonGhost} disabled={busy || audio.status !== "idle"} onClick={() => audio.play(word.term)}>▶ 英式发音</button></>}
      {mode === "recall" && <><h2>{cue.title || "这张卡还没有可用释义"}</h2>{cue.detail && <p>{cue.detail}</p>}</>}
      {mode === "spelling" && <><h2>听音写词</h2><button type="button" className={ui.button} disabled={busy || audio.status === "starting"} onClick={playPrompt}>{audio.status === "starting" ? "正在准备发音…" : audio.status === "playing" ? "停止播放" : "▶ 播放 / 重听"}</button><p>听完后独立输入，不显示单词或音标。</p>{!draft.audioPlayed && <p className={styles.small}>完整听完一次，才能核对答案或查看答案。</p>}</>}
      {mode === "context" && <><h2>语境填词</h2><blockquote>{context || "这张卡还没有包含该词的来源句或例句。"}</blockquote></>}
    </div>
    {audio.error && <p role="status" className={ui.error}>{audio.error}{mode === "spelling" && draft.audioPlayed ? " 此前已听完的记录仍有效。" : ""}</p>}
    {!cueReady && <div className={styles.cardActions}><button type="button" className={ui.buttonGhost} disabled={busy} onClick={onEdit}>补充词条资料</button><button type="button" className={ui.buttonSecondary} disabled={busy} onClick={onSkip}>暂缓此词</button><p className={styles.small}>补充资料或暂缓不会新增评分记录。</p></div>}
    {mode === "spelling" && audio.error && !draft.audioPlayed && <div className={styles.cardActions}><button type="button" className={ui.buttonSecondary} disabled={busy} onClick={onSkip}>暂缓此词</button><p className={styles.small}>发音不可用时可暂缓，或切换练习方式。</p></div>}
    {cueReady && <>
      {requiresTyping && <label className={styles.answer}><span>你的答案</span><input ref={inputRef} className={ui.input} value={draft.answer} onChange={(event) => onDraftChange({ answer: event.target.value, gaveUp: false, confirmedTypo: false })} onCompositionStart={() => { composing.current = true; compositionEndedAt.current = null; }} onCompositionEnd={(event) => { composing.current = false; compositionEndedAt.current = event.timeStamp; }} onKeyDown={(event) => {
        const justComposed = compositionEndedAt.current !== null && event.timeStamp - compositionEndedAt.current < 50;
        if (event.key !== "Enter" || composing.current || justComposed || event.nativeEvent.isComposing || event.keyCode === 229) return;
        event.preventDefault(); reveal();
      }} placeholder="输入英文单词或短语" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} maxLength={2000} disabled={revealed || busy || versionChanged} /></label>}
      {!revealed ? <div className={styles.cardActions}><button type="button" className={ui.button} disabled={busy || !ready || (requiresTyping && !draft.answer.trim())} onClick={() => reveal()}>{requiresTyping ? "核对答案" : "显示答案"}</button><button type="button" className={ui.buttonSecondary} disabled={busy || !ready} onClick={() => reveal(true)}>想不起来，查看答案</button></div> : <div className={styles.back}>
        <h2>{word.term} <button type="button" className={ui.buttonGhost} aria-label="播放单词" disabled={busy || audio.status !== "idle"} onClick={() => audio.play(word.term)}>▶</button></h2>
        <strong>{word.meaningZh || "尚未补充中文释义"}</strong>{word.definitionEn && <p>{word.definitionEn}</p>}
        {draft.gaveUp ? <p className={styles.wrong} role="status">本次未能独立想起，选择重学进行短期巩固。</p> : requiresTyping && <p className={correct ? styles.correct : styles.wrong} role="status">{correct ? "✓ 拼写正确" : `✗ 你的答案：${draft.answer}。正确答案：${word.term}。`}</p>}
        {typoCandidate && <label className={styles.typoConfirmation}><input type="checkbox" checked={draft.confirmedTypo} disabled={busy || versionChanged} onChange={(event) => onDraftChange({ confirmedTypo: event.target.checked })} /><span>我已独立想起，只是笔误</span></label>}
        {confirmedTypo && <p className={styles.small}>已确认笔误，可按实际回忆难度评分；原始答案和核对结果会保留。</p>}
        {(word.example || word.sourceSentence) && <blockquote>{word.example || word.sourceSentence}<button type="button" className={ui.buttonGhost} disabled={busy || audio.status !== "idle"} onClick={() => audio.play(word.example || word.sourceSentence)}>▶ 读例句</button></blockquote>}
        {previewError && <div role="alert"><p>{previewError}</p><button type="button" className={ui.buttonSecondary} disabled={busy} onClick={retryPreview}>重试复习时间</button></div>}
        {!preview && !previewError && <p role="status">正在计算下次复习时间…</p>}
        <div className={styles.ratings}>{ratings.map((rating) => <button type="button" disabled={busy || !preview || !ready || (needsRelearning && rating.value !== "again")} key={rating.value} onClick={() => review(rating.value, Date.now())}><strong>{rating.label}</strong><span>{rating.description}</span><small>{versionChanged ? "需要同步" : preview ? vocabularyIntervalLabel(preview.ratings[rating.value].intervalSeconds) : "计算中"}</small></button>)}</div>
        <p className={styles.small}>按这次独立回忆的难度评分。按钮时间为预计间隔，保存时按实际作答时间计算。</p>
        <dl className={styles.details}>
          {word.lemma && <><dt>原形</dt><dd>{word.lemma}</dd></>}
          {word.sourceMaterial && <><dt>来源</dt><dd>{word.sourceMaterial}</dd></>}
          {word.sourceSentence && <><dt>来源句</dt><dd>{word.sourceSentence}</dd></>}
          {([ ["搭配", word.collocations], ["同义词", word.synonyms], ["反义词", word.antonyms], ["词族", word.wordFamily], ["标签", word.tags] ] as const).filter(([, values]) => values.length).map(([label, values]) => <div key={label}><dt>{label}</dt><dd>{values.join(" · ")}</dd></div>)}
          {word.notes && <><dt>笔记</dt><dd>{word.notes}</dd></>}
        </dl>
      </div>}
    </>}
  </section>;
}
