"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { MorphologyLesson, MorphologyWord } from "@/lib/morphology";
import { useVocabularyCardAudio } from "./vocabulary-card-audio";
import { morphologyKindLabel, morphologyTheme } from "./morphology-catalogue";
import ui from "./page-ui.module.css";
import styles from "./morphology.module.css";

const relationLabels = { derivation: "现代构词", etymology: "历史词源", mnemonic: "辅助记忆" };
export function MorphologySources({ lesson, sourceIds }: { lesson: MorphologyLesson; sourceIds?: string[] }) {
  const sources = sourceIds ? lesson.sources.filter(source => sourceIds.includes(source.id)) : lesson.sources;
  return <details className={styles.sourceDetails}><summary>资料来源与许可</summary><ol>{sources.map(source => <li key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a><br />{source.license} · 核对日期 {source.reviewedAt}<br />{source.note}</li>)}</ol><p>讲解和学习例句均供构词学习使用，不是雅思原题；具体词义应结合语境理解。</p></details>;
}

export function MorphologyWordDetails({ word, lesson, onSpeak, disabled = false }: { word: MorphologyWord; lesson: MorphologyLesson; onSpeak: (text: string) => void; disabled?: boolean }) {
  return <>
    <div className={styles.wordMeta}><span className={ui.pill}>{word.partOfSpeech}</span><span className={ui.pill}>{relationLabels[word.relation]}</span>{word.level ? <span className={ui.pill}>{word.level}</span> : <span className={styles.small}>等级未标注</span>}{word.illustrative && <span className={styles.small}>构词示例</span>}</div>
    <p><strong>{word.meaningZh}</strong><br />{word.definitionEn}</p>
    <div className={styles.segments} aria-label={`${word.term} 构词部件`}>{word.segments.map((segment, index) => <div key={index} className={styles.segment}><strong>{segment.surface}</strong><small>{segment.meaningZh}</small></div>)}</div>
    <p>{word.explanationZh}</p>
    {word.examples.map(example => <blockquote className={styles.example} key={example.id}><div><p>{example.sentence}</p><p className={styles.translation}>{example.meaningZh}</p></div><button className={ui.buttonGhost} type="button" disabled={disabled} onClick={() => onSpeak(example.sentence)} aria-label={`播放 ${word.term} 例句`}>播放例句</button></blockquote>)}
    {word.levelSource && <p className={styles.small}>等级依据：{word.levelSource}</p>}
    <MorphologySources lesson={lesson} sourceIds={word.sourceIds} />
  </>;
}

export function MorphologyLessonContent({ lesson, dataEpoch, disabled, onStale }: { lesson: MorphologyLesson; dataEpoch: string; disabled: boolean; onStale: (message: string) => void }) {
  const audio = useVocabularyCardAudio(`${lesson.id}:${lesson.version}:teaching:${disabled}`);
  const [enrolling, setEnrolling] = useState<string | null>(null); const [messages, setMessages] = useState<Record<string, string>>({}); const [enrolled, setEnrolled] = useState<Record<string, string>>({});
  const operations = useRef(new Map<string, string>());
  const theme = morphologyTheme(lesson.form, lesson.titleZh);
  async function enroll(word: MorphologyWord) {
    const key = lesson.id + ":" + lesson.version + ":" + word.id;
    if (!operations.current.has(key)) operations.current.set(key, crypto.randomUUID());
    setEnrolling(word.id); audio.cancel();
    try {
      const response = await fetch("/api/morphology/enroll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataEpoch, operationId: operations.current.get(key), lessonId: lesson.id, lessonVersion: lesson.version, wordId: word.id }) });
      const payload = await response.json();
      if (response.status === 409) { onStale(payload.error || "资料版本已变化，请保留输入并刷新课程。"); return; }
      if (!response.ok) throw new Error(payload.error || "尚未加入，请重试。");
      setMessages(current => ({ ...current, [word.id]: payload.message || "已保存选择，原单词进度保持不变。" }));
      setEnrolled(current => ({ ...current, [word.id]: payload.status || "added" }));
    } catch (error) { setMessages(current => ({ ...current, [word.id]: error instanceof Error ? error.message : "保存结果尚未确认。重试会使用原操作编号。" })); }
    finally { setEnrolling(null); }
  }
  return <div className={styles.prose}>
    <p className={ui.eyebrow}>{morphologyKindLabel[lesson.kind]} · 词群小课</p><h2 className={styles.form}>{lesson.form}</h2><p className={styles.meaning}>{[theme, lesson.meaningZh].filter((text, index, all) => text && all.indexOf(text) === index).join(" · ")}</p>
    {lesson.variants.length > 0 && <p className={styles.small}>常见形式：{lesson.variants.join(" / ")}</p>}
    <p>{lesson.overviewZh}</p><div className={styles.rule}><h3>组合与拼写规律</h3><p>{lesson.spellingZh}</p></div><div className={styles.rule}><h3>使用边界</h3><p>{lesson.limitsZh}</p></div>
    {audio.error && <p className={ui.error} role="alert">{audio.error}</p>}
    <section className={styles.words} aria-label="关联词群">{lesson.words.map(word => <article key={word.id} className={styles.word}><div className={styles.heading}><h3>{word.term}</h3><div className={styles.actions}><button className={ui.buttonGhost} type="button" onClick={() => audio.play(word.term)} disabled={disabled}>单词发音</button>{!word.illustrative && <button className={ui.buttonSecondary} type="button" disabled={disabled || Boolean(enrolling) || Boolean(enrolled[word.id])} onClick={() => void enroll(word)}>{enrolling === word.id ? "正在保存…" : enrolled[word.id] === "paused" ? "原词已暂停" : enrolled[word.id] ? "已保存选择" : "加入词汇学习"}</button>}</div></div>
      <MorphologyWordDetails word={word} lesson={lesson} disabled={disabled} onSpeak={text => audio.play(text)} />
      {word.illustrative && <p className={styles.small}>此词仅用于说明构词，不作为新增学习词推荐。</p>}
      {messages[word.id] && <p role="status" className={ui.notice}>{messages[word.id]}{enrolled[word.id] === "paused" && <> <Link href="/vocabulary">前往词库恢复学习</Link></>}</p>}
    </article>)}</section>
    <MorphologySources lesson={lesson} />
  </div>;
}
