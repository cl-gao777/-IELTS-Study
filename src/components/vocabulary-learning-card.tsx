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
    <div className={styles.front}><span>{word.ipa || word.pronunciation} {word.partOfSpeech}</span><h2>{word.term}</h2><p>{intro ? "熟词也有新用法。先理解这个义项，再做语境巩固。" : "先理解释义和例句，再进行第一次回忆。"}</p><button type="button" className={ui.buttonGhost} disabled={busy || audio.status !== "idle"} onClick={() => audio.play(word.term)}>▶ 英式发音</button></div>
    {audio.error && <p className={ui.error} role="status">{audio.error}</p>}
    <div className={styles.back}>
      <strong>{target?.meaningZh ?? (exercise?.meaningZh || word.meaningZh || "尚未补充中文释义")}</strong>
      {word.definitionEn && <p>{word.definitionEn}</p>}
      {(exercise?.sentence || word.example || word.sourceSentence) && <blockquote>{exercise?.sentence || word.example || word.sourceSentence}</blockquote>}
      {word.sourceSentence && word.example && word.sourceSentence !== word.example && <blockquote>{word.sourceSentence}</blockquote>}
      {!usableMeaning && <p className={ui.notice}>请先补充可用释义，才能安排第一次回忆。</p>}
      <div className={styles.cardActions}>
        {usableMeaning ? <button ref={primaryRef} type="button" aria-keyshortcuts="Enter" className={ui.button} disabled={busy} onClick={() => { audio.cancel(); onLearn(personalWord); }}>{busy ? "正在保存…" : intro ? "理解这个用法，1分钟后巩固" : "已学习，1分钟后回忆"}</button> : <button type="button" className={ui.button} disabled={busy} onClick={onEdit}>补充词条资料</button>}
        <button type="button" className={ui.buttonSecondary} disabled={busy} onClick={onSkip}>暂缓此词</button>
      </div>
      {usableMeaning && <p className={styles.shortcutHint}>按 <kbd>Enter</kbd> 确认已学习</p>}
      <p className={styles.small}>{intro ? "确认后安排 1 分钟、10 分钟语境巩固，原单词的 FSRS 和到期时间保持不变。未确认或暂缓不计入已学习。" : "学习只安排第一次回忆，不产生评分或错误记录。"}</p>
      {target && <><VocabularyTargetDetails target={target} />{onKnowTarget && <div className={styles.cardActions}><button type="button" className={ui.buttonGhost} disabled={busy} onClick={onKnowTarget}>这个用法已会</button><p className={styles.small}>仅保存你的自报选择，不记为答对或实测掌握。</p></div>}</>}
      {word.sourceMaterial && <dl className={styles.details}><dt>来源</dt><dd>{word.sourceMaterial}</dd></dl>}
    </div>
  </section>;
}
