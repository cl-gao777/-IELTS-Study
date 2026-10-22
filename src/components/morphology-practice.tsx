"use client";

import { useEffect, useRef } from "react";
import type { MorphologyClientSnapshot } from "@/lib/morphology-client";
import { MorphologyClient } from "@/lib/morphology-client";
import type { MorphologySession } from "@/lib/morphology";
import { useVocabularyCardAudio } from "./vocabulary-card-audio";
import { MorphologySources, MorphologyWordDetails } from "./morphology-lesson";
import { morphologyTitle } from "./morphology-catalogue";
import ui from "./page-ui.module.css";
import styles from "./morphology.module.css";

const labels = { meaning: "部件辨义", structure: "构词辨析", context: "语境填空" };
export function MorphologyPractice({ client, state }: { client: MorphologyClient; state: MorphologyClientSnapshot }) {
  const session = state.workspace?.session; const question = session?.state.questions[session.state.questionIndex];
  const result = session?.state.results.find(item => item.questionId === question?.id);
  const inputRef = useRef<HTMLInputElement>(null); const promptRef = useRef<HTMLHeadingElement>(null);
  const audio = useVocabularyCardAudio(`${session?.id}:${question?.id}:${Boolean(result)}:${state.frozen}:${state.busy}`);
  useEffect(() => { if (!result) { if (question?.kind === "context") inputRef.current?.focus(); else promptRef.current?.focus(); } }, [question?.id, question?.kind, result]);
  if (!session || !question) return <p className={ui.empty}>当前没有可用题目，请同步状态或返回课程目录。</p>;
  const locked = state.busy || state.frozen || Boolean(state.pending) || session.state.paused;
  const word = result && question.wordId ? session.state.lesson.words.find(item => item.id === question.wordId) : null;
  return <section className={`${ui.panel} ${styles.questionCard}`} aria-label="词根词缀练习">
    <div className={styles.questionTop}><span>{labels[question.kind]} · 第 {session.state.questionIndex + 1} / {session.state.questions.length} 题</span><span>{session.state.retry === "initial" ? "首次练习" : session.state.retry === "weak" ? "重练薄弱题" : "重练整课"}{session.state.hintUsed ? " · 已使用提示" : " · 独立作答"}</span></div>
    <h2 className={styles.questionTitle} ref={promptRef} tabIndex={-1}>{question.prompt}</h2>
    <form onSubmit={event => { event.preventDefault(); if (!locked && !result && session.state.input.trim()) void client.submit(); }}>
      {question.options.length > 0 ? <fieldset className={styles.options} disabled={locked || Boolean(result)}><legend>选择一个答案</legend>{question.options.map((option, index) => <label className={styles.option} key={option}><input type="radio" name={question.id} value={option} checked={session.state.input === option} onChange={() => client.setInput(option)} /><span>{String.fromCharCode(65 + index)}. {option}</span></label>)}</fieldset>
        : <label className={styles.answer}>你的答案<input ref={inputRef} className={ui.input} aria-label="词根练习答案" value={session.state.input} onChange={event => client.setInput(event.target.value)} disabled={locked || Boolean(result)} autoComplete="off" autoCorrect="off" spellCheck={false} autoCapitalize="none" placeholder="输入句中需要的英文词形" onKeyDown={event => { if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault(); }} /></label>}
      {!result && <div className={styles.bottomActions}><div className={styles.actions}><button type="submit" className={ui.button} disabled={locked || !session.state.input.trim()}>核对答案</button><button type="button" className={ui.buttonSecondary} disabled={locked} onClick={() => void client.submit(true)}>想不起来</button></div><button type="button" className={ui.buttonGhost} disabled={locked || session.state.hintUsed} onClick={() => void client.action("hint")}>{session.state.hintUsed ? "已查看提示" : "查看构词提示"}</button></div>}
    </form>
    {session.state.hintUsed && !result && <aside className={styles.hint} aria-label="构词提示"><strong>提示</strong><p>{question.hint}</p><span className={styles.small}>本题已标记为有提示练习，不计入首次独立准确率。</span></aside>}
    {result && <div className={styles.feedback} aria-live="polite"><h3 className={result.correct ? styles.correct : styles.incorrect}>{result.gaveUp ? "这次没有想起" : result.correct ? "回答正确" : "一起核对这个用法"}</h3><p>你的回答：<strong>{result.answer || "（未填写）"}</strong>{result.hintUsed ? " · 使用提示" : " · 未使用提示"}</p><p>本题答案：<strong>{result.acceptedAnswers.join(" / ")}</strong></p><p>{result.explanation}</p>
      {result.sentence && <blockquote className={styles.fullSentence}>{result.sentence}<br /><button type="button" className={ui.buttonGhost} onClick={() => audio.play(result.sentence)} disabled={locked}>播放完整例句</button></blockquote>}
      {audio.error && <p role="alert" className={ui.error}>{audio.error}</p>}
      {word && <details className={styles.sourceDetails}><summary>查看 {word.term} 的完整构词资料</summary><MorphologyWordDetails word={word} lesson={session.state.lesson} disabled={locked} onSpeak={text => audio.play(text)} /></details>}
      <MorphologySources lesson={session.state.lesson} sourceIds={word?.sourceIds} />
      <div className={styles.bottomActions}><p className={styles.small}>核对后的原回答已固定。课程练习不会修改单词 FSRS。</p><button type="button" className={ui.button} disabled={locked} onClick={() => { audio.cancel(); void client.action("next"); }}>{session.state.questionIndex + 1 < session.state.questions.length ? "继续下一题" : "完成本课练习"}</button></div>
    </div>}
  </section>;
}

export function MorphologyResults({ session, busy, onRetry }: { session: MorphologySession; busy: boolean; onRetry: (kind: "whole" | "weak") => void }) {
  const results = session.state.results; const independent = results.filter(result => !result.hintUsed); const hinted = results.filter(result => result.hintUsed); const first = independent.filter(result => result.firstAttempt);
  const weak = results.filter(result => !result.correct || result.hintUsed);
  return <section className={ui.panel} aria-label="词根课程练习结果"><p className={ui.eyebrow}>本课练习已完成</p><h2>{morphologyTitle(session.state.lesson.form, session.state.lesson.titleZh)}</h2><p className={styles.small}>完成表示你做完了本轮题目，不代表已掌握。随时可以重练，不会产生到期任务或单词评分。</p>
    <dl className={styles.overview}><div><dt>本轮独立正确</dt><dd>{independent.filter(result => result.correct).length} / {independent.length}</dd></div><div><dt>有提示正确</dt><dd>{hinted.filter(result => result.correct).length} / {hinted.length}</dd></div><div><dt>首次独立样本</dt><dd>{first.filter(result => result.correct).length} / {first.length}</dd></div></dl>
    <div className={styles.actions}><button type="button" className={ui.button} disabled={busy} onClick={() => onRetry("whole")}>重练整课</button><button type="button" className={ui.buttonSecondary} disabled={busy || !weak.length} onClick={() => onRetry("weak")}>重练答错及提示题（{weak.length}）</button></div>
    <ol className={styles.runResults}>{results.map((result, index) => <li key={result.questionId}><details><summary><span className={result.correct ? styles.correct : styles.incorrect}>第 {index + 1} 题 · {result.correct ? "正确" : "未答对"}</span>{result.hintUsed ? " · 有提示" : " · 独立"}{!result.firstAttempt && " · 重练样本"}</summary><p>原回答：{result.answer || "（未填写）"}</p><p>本题答案：{result.acceptedAnswers.join(" / ")}</p><p>{result.explanation}</p>{result.sentence && <blockquote className={styles.fullSentence}>{result.sentence}</blockquote>}</details></li>)}</ol>
  </section>;
}
