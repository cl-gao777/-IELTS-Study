"use client";

import { useEffect, useState } from "react";
import type { ReviewRating } from "@/lib/srs";
import type { VocabularyReviewPreview } from "@/lib/vocabulary-scheduler";
import type { VocabularyCardDraft } from "@/lib/vocabulary-session";
import { type VocabularyEntry, type VocabularyReviewMode } from "@/lib/vocabulary";
import { vocabularyCardAnswers, vocabularyCardContext, vocabularyCardContinuation, vocabularyCardCorrect, vocabularyCardMeaning, vocabularyCardRecallCue, vocabularyCardReviewBinding, vocabularyCardTypo, vocabularyCardWord } from "@/lib/vocabulary-card-presentation";
import type { VocabularyRatingSource } from "@/lib/vocabulary-course";
import { vocabularyIntervalLabel } from "@/lib/vocabulary-practice";
import { useVocabularyCardAudio } from "./vocabulary-card-audio";
import { VocabularyTargetDetails } from "./vocabulary-target-details";
import { useVocabularyEnter } from "./use-vocabulary-enter";
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
  ratingSource: VocabularyRatingSource;
  mode: VocabularyReviewMode;
  userAnswer: string;
  confirmedTypo: boolean;
  gaveUp: boolean;
  durationSeconds: number;
  continueWithPractice?: boolean;
};

type PreviewSnapshot = { key: string; retry: number; preview: VocabularyReviewPreview | null; error: string };
function useReviewPreview(wordId: string, wordVersion: number, revealed: boolean, binding: string) {
  const [snapshot, setSnapshot] = useState<PreviewSnapshot | null>(null);
  const [retry, setRetry] = useState(0);
  const key = wordId + ":" + wordVersion + ":" + binding;
  useEffect(() => {
    if (!revealed) return;
    const controller = new AbortController();
    fetch(`/api/vocabulary/${encodeURIComponent(wordId)}/review${binding ? `?${binding}` : ""}`, { cache: "no-store", signal: controller.signal })
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
  }, [wordId, wordVersion, revealed, retry, key, binding]);
  const current = snapshot?.key === key && snapshot.retry === retry ? snapshot : null;
  return { preview: current?.preview ?? null, error: current?.error ?? "", retry: () => setRetry((value) => value + 1) };
}

export function VocabularyReviewCard({ word: personalWord, mode, draft, sessionId, sessionRevision, busy, onDraftChange, onReview, onEdit, onSkip, onRefresh, onKnowTarget, onPauseTerm }: {
  word: VocabularyEntry;
  mode: VocabularyReviewMode;
  draft: VocabularyCardDraft;
  sessionId?: string;
  sessionRevision?: number;
  busy: boolean;
  onDraftChange: (patch: Partial<VocabularyCardDraft>) => void;
  onReview: (word: VocabularyEntry, input: VocabularyCardReview) => void;
  onEdit: () => void;
  onSkip: () => void;
  onRefresh: () => void;
  onKnowTarget?: () => void;
  onPauseTerm?: () => void;
}) {
  const target = draft.target ?? null;
  const word = vocabularyCardWord(personalWord, target);
  const revealed = draft.phase === "revealed";
  const { supplemental, needsSchedulePreview, canSupplement } = vocabularyCardContinuation(mode, draft);
  const { cardRef, primaryRef, answerRef: inputRef } = useVocabularyEnter();
  const cue = vocabularyCardRecallCue(word, target, draft.exercise);
  const context = vocabularyCardContext(word, draft.exercise, target);
  const acceptedAnswers = vocabularyCardAnswers(word, mode, draft.exercise, target);
  const requiresTyping = mode !== "recognition";
  const correct = requiresTyping ? vocabularyCardCorrect(draft.answer, acceptedAnswers) : null;
  const cueReady = mode === "recall" ? Boolean(cue.title) : mode === "context" ? Boolean(context) : true;
  const audioReady = mode !== "spelling" || draft.audioPlayed;
  const binding = vocabularyCardReviewBinding(draft);
  const bindingQuery = target && binding && sessionId && sessionRevision !== undefined
    ? new URLSearchParams({ sessionId, expectedSessionRevision: String(sessionRevision), ...Object.fromEntries(Object.entries(binding).map(([key, value]) => [key, String(value)])) }).toString() : "";
  const { preview, error: previewError, retry: retryPreview } = useReviewPreview(word.id, draft.wordVersion, revealed && needsSchedulePreview && Boolean(binding), bindingQuery);
  const versionChanged = word.id !== draft.wordId || word.reviewVersion !== draft.wordVersion || !binding || Boolean(preview && preview.wordVersion !== draft.wordVersion);
  const typoCandidate = requiresTyping && !draft.gaveUp && correct === false && vocabularyCardTypo(draft.answer, acceptedAnswers);
  const confirmedTypo = typoCandidate && draft.confirmedTypo;
  const needsRelearning = draft.gaveUp || (correct === false && !confirmedTypo);
  const suggestedRating: ReviewRating = needsRelearning ? "again" : "good";
  const selectedRating = needsRelearning ? "again" : draft.requestedRating ?? suggestedRating;
  const ratingSource: VocabularyRatingSource = mode === "recognition" || confirmedTypo ? "self" : draft.ratingSource ?? "automatic";
  const answerSurface = mode === "context" && draft.exercise ? draft.exercise.targetSurface : word.term;
  const ready = !versionChanged && cueReady && audioReady;
  const cardIdentity = `${word.id}:${draft.wordVersion}:${mode}:${draft.exercise?.id ?? "personal"}:${draft.startedAt}`;
  const audio = useVocabularyCardAudio(cardIdentity);
  useEffect(() => { if (!revealed && requiresTyping) inputRef.current?.focus(); }, [cardIdentity, revealed, requiresTyping, inputRef]);

  function reveal(gaveUp = false) {
    if (busy || revealed || !ready || (!gaveUp && requiresTyping && !draft.answer.trim())) return;
    audio.cancel();
    onDraftChange({ phase: "revealed", gaveUp, confirmedTypo: false, requestedRating: null, ratingSource: mode === "recognition" ? "self" : "automatic" });
  }
  function review(rating: ReviewRating, submittedAt: number, continueWithPractice = false) {
    if (busy || !revealed || (needsSchedulePreview && !preview) || !ready || (needsRelearning && rating !== "again") || (continueWithPractice && !canSupplement)) return;
    const elapsed = (submittedAt - Date.parse(draft.startedAt)) / 1000;
    onReview(personalWord, { rating, ratingSource, mode, userAnswer: draft.answer, confirmedTypo: draft.confirmedTypo, gaveUp: draft.gaveUp, continueWithPractice,
      durationSeconds: Number.isFinite(elapsed) ? Math.min(3600, Math.max(0, Math.round(elapsed))) : 0 });
  }
  function playPrompt() {
    if (audio.status === "playing") audio.cancel();
    else audio.play(word.term, () => onDraftChange({ audioPlayed: true }));
  }

  return <section ref={cardRef} className={`${ui.panel} ${styles.card}`} aria-label="当前词汇练习" data-vocabulary-card data-no-vocabulary>
    <div className={styles.cardHeader}><span>{vocabularyModes.find((item) => item.value === mode)?.description}</span><div className={styles.cardHeaderActions}>{onPauseTerm && <button type="button" className={ui.buttonGhost} disabled={busy} onClick={onPauseTerm}>整词暂不学习</button>}{revealed && <button type="button" className={ui.buttonGhost} disabled={busy} onClick={onEdit}>{target ? "查看用法资料" : "编辑词条"}</button>}</div></div>
    {supplemental && <p className={styles.supplementalBadge}>{draft.purpose === "consolidation" ? "用法巩固" : "追加练习"} · 不改变复习计划</p>}
    {draft.purpose === "merged" && <p className={styles.supplementalBadge}>到期复习与用法巩固 · 本次只评分一次</p>}
    {versionChanged && <div className={ui.notice} role="alert"><p>词卡已更新，本次答案尚未评分。同步词卡后再继续。</p><button type="button" className={ui.buttonSecondary} disabled={busy} onClick={onRefresh}>同步词卡</button></div>}
    <div className={styles.front}>
      {mode === "recognition" && <><span>{word.ipa || word.pronunciation} {word.partOfSpeech}</span><h2>{word.term}</h2><button type="button" className={ui.buttonGhost} disabled={busy || audio.status !== "idle"} onClick={() => audio.play(word.term)}>▶ 英式发音</button></>}
      {mode === "recall" && <><h2>{cue.title || "这张卡还没有可用释义"}</h2>{cue.detail && <p>{cue.detail}</p>}</>}
      {mode === "spelling" && <><h2>听音写词</h2><button type="button" className={ui.button} disabled={busy || audio.status === "starting"} onClick={playPrompt}>{audio.status === "starting" ? "正在准备发音…" : audio.status === "playing" ? "停止播放" : "▶ 播放 / 重听"}</button><p>听完后独立输入，不显示单词或音标。</p>{!draft.audioPlayed && <p className={styles.small}>完整听完一次，才能核对答案或查看答案。</p>}</>}
      {mode === "context" && <><h2>补全这句话</h2><blockquote className={styles.contextSentence}>{context || "这张卡还没有包含该词的来源句或例句。"}</blockquote>{context && <p className={styles.contextMeaning}><span>此处意思</span><strong>{vocabularyCardMeaning(word, draft.exercise, target) || "待补充释义"}</strong></p>}</>}
    </div>
    {audio.error && <p role="status" className={ui.error}>{audio.error}{mode === "spelling" && draft.audioPlayed ? " 此前已听完的记录仍有效。" : ""}</p>}
    {!cueReady && <div className={styles.cardActions}><button type="button" className={ui.buttonGhost} disabled={busy} onClick={onEdit}>补充词条资料</button><button type="button" className={ui.buttonSecondary} disabled={busy} onClick={onSkip}>暂缓此词</button><p className={styles.small}>补充资料或暂缓不会新增评分记录。</p></div>}
    {mode === "spelling" && audio.error && !draft.audioPlayed && <div className={styles.cardActions}><button type="button" className={ui.buttonSecondary} disabled={busy} onClick={onSkip}>暂缓此词</button><p className={styles.small}>发音不可用时可暂缓，或切换练习方式。</p></div>}
    {cueReady && <>
      {requiresTyping && <label className={styles.answer}><span>你的答案</span><input ref={inputRef} className={ui.input} value={draft.answer} onChange={(event) => onDraftChange({ answer: event.target.value, gaveUp: false, confirmedTypo: false, requestedRating: null, ratingSource: "automatic" })} placeholder="输入英文单词或短语" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} maxLength={2000} disabled={revealed || busy || versionChanged} /></label>}
      {!revealed ? <><div className={styles.cardActions}><button ref={primaryRef} type="button" aria-keyshortcuts="Enter" className={ui.button} disabled={busy || !ready || (requiresTyping && !draft.answer.trim())} onClick={() => reveal()}>{requiresTyping ? "核对答案" : "显示答案"}</button><button type="button" className={ui.buttonSecondary} disabled={busy || !ready} onClick={() => reveal(true)}>想不起来，查看答案</button></div><p className={styles.shortcutHint}>按 <kbd>Enter</kbd> {requiresTyping ? "核对答案" : "显示答案"}</p></> : <div className={styles.back}>
        <h2>{word.term} <button type="button" className={ui.buttonGhost} aria-label="播放单词" disabled={busy || audio.status !== "idle"} onClick={() => audio.play(word.term)}>▶</button></h2>
        {word.partOfSpeech && <p className={styles.small}>{word.partOfSpeech}</p>}<strong>{target?.meaningZh ?? (mode === "context" && draft.exercise ? draft.exercise.meaningZh : word.meaningZh || "尚未补充中文释义")}</strong>{word.definitionEn && <p>{word.definitionEn}</p>}
        {draft.gaveUp ? <p className={styles.wrong} role="status">{supplemental ? "本次未能独立想起，只记录辅助练习结果。" : "本次未能独立想起，将安排短期巩固。"}</p> : requiresTyping && <p className={correct ? styles.correct : styles.wrong} role="status">{correct ? "✓ 回答正确" : `✗ 你的答案：${draft.answer}。此处答案：${answerSurface}。`}</p>}
        {typoCandidate && <label className={styles.typoConfirmation}><input type="checkbox" checked={draft.confirmedTypo} disabled={busy || versionChanged} onChange={(event) => onDraftChange({ confirmedTypo: event.target.checked, requestedRating: event.target.checked ? "good" : null, ratingSource: event.target.checked ? "self" : "automatic" })} /><span>我已独立想起，只是笔误</span></label>}
        {confirmedTypo && <p className={styles.small}>{supplemental ? "原始答案、核对结果和笔误确认会保留，不改变复习计划。" : "已确认笔误，可按实际回忆难度评分；原始答案和核对结果会保留。"}</p>}
        {(draft.exercise?.sentence || word.example || word.sourceSentence) && <blockquote>{draft.exercise?.sentence || word.example || word.sourceSentence}<button type="button" className={ui.buttonGhost} disabled={busy || audio.status !== "idle"} onClick={() => audio.play(draft.exercise?.sentence || word.example || word.sourceSentence)}>▶ 读例句</button></blockquote>}
        {needsSchedulePreview && previewError && <div role="alert"><p>{previewError}</p><button type="button" className={ui.buttonSecondary} disabled={busy} onClick={retryPreview}>重试复习时间</button></div>}
        {needsSchedulePreview && !preview && !previewError && <p role="status">正在计算下次复习时间…</p>}
        <div className={styles.continueRow}><p>{supplemental ? <><strong>只保存这次练习结果</strong><small>原单词的到期时间和 FSRS 进度保持不变。</small></> : <><strong>{ratings.find((rating) => rating.value === selectedRating)?.label}</strong><span>{preview ? ` · ${vocabularyIntervalLabel(preview.ratings[selectedRating].intervalSeconds)}复习` : ""}</span><small>{ratingSource === "automatic" ? "根据本次答案建议" : "按你选择的回忆难度安排"}</small></>}</p><div className={styles.continueActions}><button ref={primaryRef} type="button" aria-keyshortcuts="Enter" className={ui.button} disabled={busy || (needsSchedulePreview && !preview) || !ready} onClick={() => review(selectedRating, Date.now())}>{busy ? "正在保存…" : "继续"}</button>{canSupplement && <button type="button" className={ui.buttonSecondary} disabled={busy || !preview || !ready} onClick={() => review(selectedRating, Date.now(), true)}>继续并再练一句</button>}</div></div>
        <p className={styles.shortcutHint}>按 <kbd>Enter</kbd> 保存并继续</p>
        {!supplemental && <details className={styles.difficulty}><summary>调整这次回忆的难度</summary><div className={styles.ratings}>{ratings.map((rating) => <button type="button" aria-pressed={selectedRating === rating.value} disabled={busy || !preview || !ready || (needsRelearning && rating.value !== "again")} key={rating.value} onClick={() => onDraftChange({ requestedRating: rating.value, ratingSource: "self" })}><strong>{rating.label}</strong><span>{rating.description}</span><small>{versionChanged ? "需要同步" : preview ? vocabularyIntervalLabel(preview.ratings[rating.value].intervalSeconds) : "计算中"}</small></button>)}</div><p className={styles.small}>选择后点击“继续”保存。未能独立想起时使用 Again；预计间隔在保存时按实际作答时间计算。</p></details>}
        {target && <><VocabularyTargetDetails target={target} />{onKnowTarget && <div className={styles.cardActions}><button type="button" className={ui.buttonGhost} disabled={busy} onClick={onKnowTarget}>这个用法已会</button><p className={styles.small}>仅保存你的自报选择，不记为答对或实测掌握。</p></div>}</>}
        <details className={styles.wordDetails}><summary>词条资料与来源</summary><dl className={styles.details}>
          {word.lemma && <><dt>原形</dt><dd>{word.lemma}</dd></>}
          {word.sourceMaterial && <><dt>来源</dt><dd>{word.sourceMaterial}</dd></>}
          {word.sourceSentence && <><dt>来源句</dt><dd>{word.sourceSentence}</dd></>}
          {([ ["搭配", word.collocations], ["同义词", word.synonyms], ["反义词", word.antonyms], ["词族", word.wordFamily], ["标签", word.tags] ] as const).filter(([, values]) => values.length).map(([label, values]) => <div key={label}><dt>{label}</dt><dd>{values.join(" · ")}</dd></div>)}
          {word.notes && <><dt>笔记</dt><dd>{word.notes}</dd></>}
          {draft.exercise?.source && <><dt>题目来源</dt><dd>{draft.exercise.source}</dd></>}
        </dl></details>
      </div>}
    </>}
  </section>;
}
