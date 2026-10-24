"use client";

import type { VocabularyEntry } from "@/lib/vocabulary";
import type { VocabularyExerciseSnapshot } from "@/lib/vocabulary-course";
import { vocabularyRecallCue } from "@/lib/vocabulary-practice";
import type { VocabularyCardDraft } from "@/lib/vocabulary-session";
import { vocabularyCardWord } from "@/lib/vocabulary-card-presentation";
import { useVocabularyCardAudio } from "./vocabulary-card-audio";
import { VocabularyTargetDetails } from "./vocabulary-target-details";
import { useVocabularyEnter } from "./use-vocabulary-enter";
import ui from "./page-ui.module.css";
import styles from "./vocabulary.module.css";

export function VocabularyLearningCard({ word: personalWord, exercise, draft, busy, onLearn, onEdit, onSkip, onKnowTarget, onPauseTerm }: {
  word: VocabularyEntry;
  exercise?: VocabularyExerciseSnapshot | null;
  draft?: VocabularyCardDraft | null;
  busy: boolean;
  onLearn: (word: VocabularyEntry) => void;
  onEdit: () => void;
  onSkip: () => void;
  onKnowTarget?: () => void;
  onPauseTerm?: () => void;
}) {
  const target = draft?.target ?? null;
  const { cardRef, primaryRef } = useVocabularyEnter();
  const word = vocabularyCardWord(personalWord, target);
  const intro = draft?.purpose === "learn-target";
  const usableMeaning = Boolean(target?.meaningZh ?? (exercise?.meaningZh || vocabularyRecallCue(word).title));
  const audio = useVocabularyCardAudio(`${word.id}:${target?.id ?? "personal"}:${target?.version ?? word.reviewVersion}:${draft?.startedAt ?? "intro"}`);
  return <section ref={cardRef} className={`${ui.panel} ${styles.card}`} aria-label={intro ? "学习进阶用法" : "新词学习"} data-vocabulary-learning-card data-no-vocabulary>
    <div className={styles.cardHeader}><span className={styles.learningBadge}>{intro ? "学习进阶用法" : "新词学习"}{target?.level ? ` · ${target.level}` : ""}</span><div className={styles.cardHeaderActions}>{onPauseTerm && <button type="button" className={ui.buttonGhost} disabled={busy} onClick={onPauseTerm}>整词暂不学习</button>}<button type="button" className={ui.buttonGhost} disabled={busy} onClick={onEdit}>{target ? "查看用法资料" : "编辑词条"}</button></div></div>
    <div className={styles.front}><span>{word.ipa || word.pronunciation} {word.partOfSpeech}</span><h2>{word.term}</h2><button type="button" className={ui.buttonGhost} disabled={busy || audio.status !== "idle"} onClick={() => audio.play(word.term)}>▶ 英式发音</button></div>
    {audio.error && <p className={ui.error} role="status">{audio.error}</p>}
    <div className={styles.back}>
      <strong>{target?.meaningZh ?? (exercise?.meaningZh || word.meaningZh || "尚未补充中文释义")}</strong>
      {word.definitionEn && <p>{word.definitionEn}</p>}
      {(exercise?.sentence || word.example || word.sourceSentence) && <blockquote>{exercise?.sentence || word.example || word.sourceSentence}</blockquote>}
      {!usableMeaning && <p className={ui.notice}>请先补充释义。</p>}
      <div className={styles.cardActions}>
        {usableMeaning ? <button ref={primaryRef} type="button" aria-keyshortcuts="Enter" className={ui.button} disabled={busy} onClick={() => { audio.cancel(); onLearn(personalWord); }}>{busy ? "正在保存…" : intro ? "理解这个用法，1分钟后巩固" : "已学习，1分钟后回忆"}</button> : <button type="button" className={ui.button} disabled={busy} onClick={onEdit}>补充词条资料</button>}
        <button type="button" className={ui.buttonSecondary} disabled={busy} onClick={onSkip}>暂缓此词</button>
      </div>
      {usableMeaning && <p className={styles.shortcutHint}>按 <kbd>Enter</kbd> 确认已学习</p>}
      {target && <><VocabularyTargetDetails target={target} exerciseSource={exercise?.source} />{onKnowTarget && <div className={styles.cardActions}><button type="button" className={ui.buttonGhost} disabled={busy} onClick={onKnowTarget}>这个用法已会</button></div>}</>}
      {!target && (word.sourceMaterial || exercise?.source || word.sourceSentence && word.example && word.sourceSentence !== word.example) && <details className={styles.wordDetails}><summary>资料与来源</summary><dl className={styles.details}>
        {word.sourceMaterial && <><dt>来源</dt><dd>{word.sourceMaterial}</dd></>}
        {exercise?.source && exercise.source !== word.sourceMaterial && <><dt>例句来源</dt><dd>{exercise.source}</dd></>}
        {word.sourceSentence && word.example && word.sourceSentence !== word.example && <><dt>原文例句</dt><dd>{word.sourceSentence}</dd></>}
      </dl></details>}
    </div>
  </section>;
}
