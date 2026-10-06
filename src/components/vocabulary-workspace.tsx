"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { VocabularyEntry } from "@/lib/vocabulary";
import { VocabularySessionClient } from "@/lib/vocabulary-session-client";
import { vocabularyReviewQueue } from "@/lib/vocabulary-practice";
import { VocabularyLibrary } from "./vocabulary-library";
import { VocabularyReviewCard, vocabularyModes } from "./vocabulary-review-card";
import { VocabularyLearningCard } from "./vocabulary-learning-card";
import ui from "./page-ui.module.css";
import styles from "./vocabulary.module.css";

export function VocabularyWorkspace({ initialWords, nowIso }: { initialWords: VocabularyEntry[]; nowIso: string }) {
  const [client] = useState(() => new VocabularySessionClient(initialWords, Date.parse(nowIso)));
  const [initialSnapshot] = useState(client.getSnapshot);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, () => initialSnapshot);
  const [editor, setEditor] = useState<VocabularyEntry | "new" | null>(null);
  useEffect(() => {
    let storage: Storage | undefined;
    try { storage = window.localStorage; } catch { /* SQLite still saves the session. */ }
    void client.initialize(storage);
    const interval = window.setInterval(() => client.tick(Date.now()), 1000);
    const restored = () => client.resetAfterRestore();
    const visible = () => { if (document.visibilityState === "visible") void client.refresh(); };
    const closing = () => { void client.flush().catch(() => undefined); };
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("ielts-studio-restores");
    if (channel) channel.onmessage = (event) => { if (event.data?.type === "studio:backup-restored") restored(); };
    window.addEventListener("studio:backup-restored", restored);
    window.addEventListener("pagehide", closing);
    document.addEventListener("visibilitychange", visible);
    return () => {
      closing(); client.dispose(); window.clearInterval(interval); window.speechSynthesis?.cancel(); channel?.close();
      window.removeEventListener("studio:backup-restored", restored); window.removeEventListener("pagehide", closing);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [client]);

  const { words, session, mode, clock, busy, ready, pending, view } = state;
  const locked = busy || !ready || Boolean(pending);
  const active = session?.status === "active";
  const current = active ? session.state.current : null;
  const word = current ? words.find((item) => item.id === current.wordId && item.reviewVersion === current.wordVersion) : undefined;
  const queue = vocabularyReviewQueue(words, clock, new Set(active ? session.state.skippedIds : []));
  const nextDue = words.filter((item) => Date.parse(item.dueAt) > clock && !session?.state.skippedIds.includes(item.id))
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))[0]?.dueAt;
  async function manage(editing?: VocabularyEntry | "new") {
    await client.enterLibrary();
    if (client.getSnapshot().view === "library") setEditor(editing ?? null);
  }
  async function save(data: Record<string, string | string[]>, id?: string) {
    const editing = id && editor && editor !== "new" && editor.id === id ? editor : undefined;
    if (id && !editing) return;
    if (await client.saveWord(data, editing)) setEditor(null);
  }

  return <div className={ui.page} data-no-vocabulary>
    <header className={ui.pageHeader}>
      <div><p className={ui.eyebrow}>Vocabulary / Spaced Repetition</p><h1>词汇学习</h1><p>先学习，再独立回忆。答案在核对后显示，复习安排和学习记录保存在本地。</p></div>
      <div className={ui.headerActions}><button className={ui.buttonSecondary} disabled={locked} onClick={() => void manage("new")}>＋ 添加词条</button></div>
    </header>
    <nav className={styles.viewTabs} aria-label="词汇工作区">
      <button type="button" aria-pressed={view === "review"} disabled={locked} onClick={() => { client.returnToReview(); setEditor(null); }}>到期复习</button>
      <button type="button" aria-pressed={view === "library"} disabled={locked} onClick={() => void manage()}>词库管理</button>
      <span className={styles.saveState} role="status">{!ready ? "正在读取学习记录…" : state.saving ? "正在保存本轮状态…" : "草稿自动保存"}</span>
    </nav>
    {state.message && <div role="status" className={ui.notice}>{state.message}</div>}
    {pending && !busy && <div className={styles.pendingActions} role="alert"><p>评分结果需要核对，当前回答已保留。</p><button className={ui.buttonSecondary} onClick={() => void client.verifyPending()}>核对保存状态</button><button className={ui.button} onClick={() => void client.retryReview()}>重试保存原评分</button></div>}
    {!ready ? <section className={ui.empty}><p>读取本轮状态后再开始，避免遗漏或重复评分。</p><button className={ui.buttonSecondary} disabled={busy} onClick={() => void client.refresh()}>重试读取</button></section>
      : view === "library" ? <VocabularyLibrary words={words} clock={clock} busy={locked} editor={editor} onEdit={setEditor} onSave={save} />
      : <div className={styles.reviewWorkspace}>
        <div className={styles.reviewToolbar}>
          <div className={styles.modes} aria-label="复习模式">{vocabularyModes.map((item) => <button key={item.value} type="button" aria-pressed={mode === item.value} disabled={locked} className={mode === item.value ? styles.activeMode : ""} onClick={() => void client.changeMode(item.value)}>{item.label}</button>)}</div>
          <dl className={styles.progressStrip} aria-label="本轮进度"><div><dt>待复习</dt><dd>{queue.length} 个</dd></div><div><dt>已评分</dt><dd>{active ? session.state.reviewed : 0} 次</dd></div><div><dt>已学习</dt><dd>{active ? session.state.learned : 0} 个</dd></div><div><dt>暂缓</dt><dd>{active ? session.state.skippedIds.length : 0} 个</dd></div></dl>
        </div>
        {word && current ? current.phase === "learn"
          ? <VocabularyLearningCard key={`${word.id}:${word.reviewVersion}`} word={word} busy={locked} onLearn={() => void client.learnWord(word)} onEdit={() => void manage(word)} onSkip={() => void client.skipCard()} />
          : <VocabularyReviewCard key={`${word.id}:${word.reviewVersion}:${mode}`} word={word} mode={mode} draft={current} busy={locked} onDraftChange={(changes) => client.changeDraft(changes)} onReview={(reviewed, input) => void client.reviewWord(reviewed, input)} onEdit={() => void manage(word)} onSkip={() => void client.skipCard()} onRefresh={() => void client.refresh()} />
          : <section className={`${ui.panel} ${styles.card}`} aria-label="本轮复习状态"><div className={styles.front}>
            <h2>{!words.length ? "从第一个词开始学习" : !active ? "准备开始新一轮" : session.state.skippedIds.length && !nextDue ? "本轮暂无其他可练词" : "当前没有到期词"}</h2>
            <p>{!words.length ? "添加词条并补充释义，再开始学习和回忆。" : !active ? "开始后按到期时间复习，新词先学习。" : "新到期的巩固词会自动进入本轮，不必反复刷新。"}</p>
            {nextDue && <p>下次到期：<time dateTime={nextDue}>{new Date(nextDue).toLocaleString("zh-CN")}</time></p>}
            {!active && words.length > 0 && <button className={ui.button} disabled={locked} onClick={() => void client.startRound()}>开始新一轮</button>}
            {active && <button className={ui.buttonSecondary} disabled={locked} onClick={() => void manage()}>结束本轮，管理词库</button>}
            {!words.length && <button className={ui.button} disabled={locked} onClick={() => void manage("new")}>添加第一个词条</button>}
          </div></section>}
        <details className={styles.memoryPlan}><summary>复习安排 · FSRS 目标保持率 90%</summary><p>每个词共用一个复习进度。新词学习后先做分钟级回忆；能独立想起后，由 FSRS 根据历史评分计算更长间隔。</p><p>Again 表示未能想起；Hard、Good、Easy 按独立回忆的难度选择。90% 是安排间隔的目标，不是实测成绩。查看词库结束本轮，切换模式暂缓当前词；这些动作不记为遗忘。</p></details>
      </div>}
  </div>;
}
