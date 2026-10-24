"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { VocabularyFocus } from "@/lib/vocabulary-target";
import type { VocabularyReviewMode } from "@/lib/vocabulary";
import type { VocabularyClientSnapshot } from "@/lib/vocabulary-session-client";
import type { VocabularyStudySnapshot } from "@/lib/vocabulary-study-client";
import { vocabularyModes } from "./vocabulary-review-card";
import ui from "./page-ui.module.css";
import styles from "./vocabulary.module.css";

type Props = {
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  state: VocabularyClientSnapshot;
  studyState: VocabularyStudySnapshot;
  locked: boolean;
  dueCount: number;
  today: number;
  successMessage?: string;
  attentionMessage?: string;
  onMode: (mode: VocabularyReviewMode) => void;
  onFocus: (focus: VocabularyFocus) => void;
  onGoal: (minutes: number) => void;
  onClearAnswer: () => void;
  onEnd: () => void;
  onRetryTime: () => void;
};

function RetainedAnswer({ retained, onClear }: { retained: NonNullable<VocabularyClientSnapshot["conflicted"]>; onClear: () => void }) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [notice, setNotice] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(retained.card.answer);
      setNotice("已复制");
    } catch {
      textarea.current?.focus(); textarea.current?.select();
      setNotice("请按 Ctrl/Cmd+C 复制");
    }
  }
  return <details className={styles.retainedAnswer}>
    <summary>保留回答（1）</summary>
    <label className={ui.field}><span>上一题未提交的回答</span><textarea ref={textarea} className={ui.textarea} rows={3} readOnly value={retained.card.answer} aria-label="保留的原回答" /></label>
    {retained.card.gaveUp && <p>当时选择了“想不起来”。</p>}
    <div className={styles.managementActions}><button type="button" className={ui.buttonSecondary} onClick={() => void copy()}>复制原回答</button><button type="button" className={ui.buttonGhost} onClick={onClear}>清除保留回答</button></div>
    {notice && <p role="status">{notice}</p>}
  </details>;
}

export function VocabularyMorePanel({ open, onClose, triggerRef, state, studyState, locked, dueCount, today, successMessage, attentionMessage, onMode, onFocus, onGoal, onClearAnswer, onEnd, onRetryTime }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { study } = studyState;
  const goal = study?.dailyGoalSeconds ?? 900;
  const active = state.session?.status === "active";
  useEffect(() => {
    const panel = dialog.current;
    if (!panel) return;
    if (open && !panel.open) panel.showModal();
    else if (!open && panel.open) panel.close();
  }, [open]);

  return <dialog ref={dialog} id="vocabulary-more" aria-labelledby="vocabulary-more-title" className={styles.morePanel}
    onClose={() => { onClose(); if (triggerRef.current?.isConnected) triggerRef.current.focus(); }}
    onClick={(event) => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) event.currentTarget.close();
    }}
    onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]')).filter((item) => item.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    <header className={styles.moreHeader}><h2 id="vocabulary-more-title">学习选项</h2><button type="button" autoFocus className={ui.buttonGhost} aria-label="关闭学习选项" onClick={() => dialog.current?.close()}>关闭</button></header>
    <div className={styles.moreBody}>
      {attentionMessage && <div role="alert" className={ui.notice}>{attentionMessage}</div>}
      {state.conflicted && <RetainedAnswer key={state.conflicted.retainedAt} retained={state.conflicted} onClear={onClearAnswer} />}
      {studyState.message && <div role="alert" className={ui.notice}>{studyState.message}<button type="button" className={ui.buttonSecondary} disabled={studyState.busy} onClick={onRetryTime}>重试同步时间</button></div>}
      <section className={styles.moreSection} aria-labelledby="vocabulary-goal-title"><h3 id="vocabulary-goal-title">每日目标</h3>
        <p>今日 {Math.floor(today / 60)} 分钟 / {Math.round(goal / 60)} 分钟{today >= goal ? " · 已完成" : ""}</p>
        <progress max={goal} value={Math.min(today, goal)} aria-label="每日有效学习时间" />
        <form key={goal} className={styles.goalForm} onSubmit={(event) => {
          event.preventDefault();
          const minutes = Number(new FormData(event.currentTarget).get("minutes"));
          if (Number.isInteger(minutes) && minutes >= 1 && minutes <= 360) onGoal(minutes);
        }}><label className={ui.field}><span>每天分钟数</span><input name="minutes" className={ui.input} type="number" min={1} max={360} step={1} required defaultValue={Math.round(goal / 60)} disabled={locked || !studyState.ready} /></label><button type="submit" className={ui.buttonSecondary} disabled={locked || !studyState.ready}>保存目标</button></form>
      </section>
      <section className={styles.moreSection} aria-labelledby="vocabulary-mode-title"><h3 id="vocabulary-mode-title">练习方式</h3><div className={styles.modes} aria-label="复习模式">{vocabularyModes.map((item) => <button type="button" key={item.value} aria-pressed={state.mode === item.value} className={state.mode === item.value ? styles.activeMode : ""} disabled={locked || Boolean(study?.paused)} onClick={() => onMode(item.value)}>{item.label}</button>)}</div><p className={styles.small}>切换方式会暂缓当前词。</p></section>
      <section className={styles.moreSection} aria-labelledby="vocabulary-focus-title"><h3 id="vocabulary-focus-title">学习设置</h3><label className={ui.field}><span>学习侧重</span><select className={ui.input} value={study?.focus ?? "ielts-advanced"} disabled={locked || !studyState.ready} onChange={(event) => onFocus(event.target.value as VocabularyFocus)}><option value="ielts-advanced">雅思实用进阶</option><option value="general">完整通用课程</option></select></label><p className={styles.small}>{study?.activeCourseTitle || (study?.activeCourseId ? "已选择新增课程" : "已暂停新增词")}</p></section>
      <section className={styles.moreSection} aria-labelledby="vocabulary-statistics-title"><h3 id="vocabulary-statistics-title">本轮统计</h3><dl className={styles.panelStats}>
        {([ ["到期复习", dueCount], ["已评分", active ? state.session!.state.reviewed : 0], ["学习 / 介绍", active ? state.session!.state.learned : 0], ["本轮暂缓", active ? state.session!.state.skippedIds.length : 0], ["用法巩固到期", state.targetCounts?.consolidationDue ?? 0], ["辅助练习", active ? state.session!.state.supplementalReviewed ?? 0 : 0], ["自报用法已会", state.targetCounts?.pausedTargets ?? 0], ["整词暂停", state.targetCounts?.pausedTerms ?? 0] ] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl></section>
      <details className={styles.memoryPlan}><summary>复习安排</summary><p>新词在学习后 1 分钟、10 分钟巩固；后续按 FSRS 安排，目标保持率 90%。各练习方式共用单词进度，新用法巩固单独记录。</p></details>
      {successMessage && <p className={styles.small} role="status">{successMessage}</p>}
      {active && <button type="button" className={ui.buttonSecondary} disabled={locked} onClick={onEnd}>结束本轮</button>}
    </div>
  </dialog>;
}
