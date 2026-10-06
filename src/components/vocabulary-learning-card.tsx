"use client";

import type { VocabularyEntry } from "@/lib/vocabulary";
import { vocabularyRecallCue } from "@/lib/vocabulary-practice";
import ui from "./page-ui.module.css";
import styles from "./vocabulary.module.css";

export function VocabularyLearningCard({ word, busy, onLearn, onEdit, onSkip }: {
  word: VocabularyEntry;
  busy: boolean;
  onLearn: (word: VocabularyEntry) => void;
  onEdit: () => void;
  onSkip: () => void;
}) {
  const usableMeaning = Boolean(vocabularyRecallCue(word).title);
  return <section className={`${ui.panel} ${styles.card}`} aria-label="新词学习" data-vocabulary-learning-card data-no-vocabulary>
    <div className={styles.cardHeader}><span className={styles.learningBadge}>新词学习</span><button type="button" className={ui.buttonGhost} disabled={busy} onClick={onEdit}>编辑词条</button></div>
    <div className={styles.front}><span>{word.ipa || word.pronunciation} {word.partOfSpeech}</span><h2>{word.term}</h2><p>先理解释义和例句，再进行第一次回忆。</p></div>
    <div className={styles.back}>
      <strong>{word.meaningZh || "尚未补充中文释义"}</strong>
      {word.definitionEn && <p>{word.definitionEn}</p>}
      {(word.example || word.sourceSentence) && <blockquote>{word.example || word.sourceSentence}</blockquote>}
      {word.sourceSentence && word.example && word.sourceSentence !== word.example && <blockquote>{word.sourceSentence}</blockquote>}
      {!usableMeaning && <p className={ui.notice}>请先补充可用释义，才能安排第一次回忆。</p>}
      <div className={styles.cardActions}>
        {usableMeaning ? <button type="button" className={ui.button} disabled={busy} onClick={() => onLearn(word)}>已学习，1分钟后回忆</button> : <button type="button" className={ui.button} disabled={busy} onClick={onEdit}>补充词条资料</button>}
        <button type="button" className={ui.buttonSecondary} disabled={busy} onClick={onSkip}>暂缓此词</button>
      </div>
      <p className={styles.small}>学习只安排第一次回忆，不产生评分或错误记录。</p>
      {word.sourceMaterial && <dl className={styles.details}><dt>来源</dt><dd>{word.sourceMaterial}</dd></dl>}
    </div>
  </section>;
}
