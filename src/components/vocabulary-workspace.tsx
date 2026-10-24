"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { normaliseVocabularyAnswer, type VocabularyEntry } from "@/lib/vocabulary";
import type { VocabularyFocus } from "@/lib/vocabulary-target";
import { VocabularySessionClient } from "@/lib/vocabulary-session-client";
import { VocabularyStudyClient } from "@/lib/vocabulary-study-client";
import { isVocabularyNew, vocabularyReviewQueue } from "@/lib/vocabulary-practice";
import { VocabularyLibrary } from "./vocabulary-library";
import { VocabularyCourses } from "./vocabulary-courses";
import { VocabularyImportPanel } from "./vocabulary-import-panel";
import { VocabularyReviewCard } from "./vocabulary-review-card";
import { VocabularyLearningCard } from "./vocabulary-learning-card";
import { VocabularyTargets } from "./vocabulary-targets";
import { VocabularyMorePanel } from "./vocabulary-more-panel";
import { vocabularyNotice } from "@/lib/vocabulary-notice";
import ui from "./page-ui.module.css";
import styles from "./vocabulary.module.css";

const elapsedLabel = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
export function VocabularyWorkspace({ initialWords, nowIso }: { initialWords: VocabularyEntry[]; nowIso: string }) {
  const [client] = useState(() => new VocabularySessionClient(initialWords, Date.parse(nowIso)));
  const [studyClient] = useState(() => new VocabularyStudyClient());
  const [initialSnapshot] = useState(client.getSnapshot);
  const [initialStudy] = useState(studyClient.getSnapshot);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, () => initialSnapshot);
  const studyState = useSyncExternalStore(studyClient.subscribe, studyClient.getSnapshot, () => initialStudy);
  const [editor, setEditor] = useState<VocabularyEntry | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [managementRevision, setManagementRevision] = useState(0);
  const [courseBusy, setCourseBusy] = useState(false);
  const [courseMessage, setCourseMessage] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let storage: Storage | undefined; try { storage = window.localStorage; } catch {}
    let ownsTimer = !navigator.locks; let acquiring = false; let releaseLock: (() => void) | undefined; let disposed = false;
    // Session recovery may activate a newly installed private course. Read its
    // study preferences afterwards so the focus selector reflects that activation.
    void client.initialize(storage).then(() => { if (!disposed) return studyClient.initialize(storage); });
    const engaged = () => {
      const current = client.getSnapshot(); const study = studyClient.getSnapshot();
      return current.ready && current.view === "review" && current.session?.status === "active" && Boolean(current.session.state.current)
        && study.ready && !study.busy && !study.study?.paused && !document.hidden && document.hasFocus();
    };
    const sample = () => {
      const active = engaged();
      if (!active && releaseLock) {
        // Seal our final sample before transferring the foreground clock.
        studyClient.sample(Date.now(), false); void studyClient.flush(true);
        releaseLock(); releaseLock = undefined; ownsTimer = false;
      }
      if (active && navigator.locks && !ownsTimer && !acquiring) {
        acquiring = true;
        void navigator.locks.request("ielts-vocabulary-study-timer", { ifAvailable: true }, async (lock) => {
          acquiring = false;
          if (!lock || disposed || !engaged()) return;
          ownsTimer = true;
          await new Promise<void>((resolve) => { releaseLock = resolve; });
          ownsTimer = false;
        }).catch(() => { acquiring = false; });
      }
      studyClient.sample(Date.now(), active && ownsTimer);
    };
    const interval = window.setInterval(() => { if (!document.hidden) client.tick(Date.now()); sample(); }, 1000);
    const restored = () => { client.resetAfterRestore(); studyClient.resetAfterRestore(); setMoreOpen(false); setEditor(null); setImporting(false); setManagementRevision((value) => value + 1); };
    const visible = () => { sample(); if (document.hidden) { void studyClient.flush(true); } else { void client.refresh(); void studyClient.refresh(); } };
    const closing = () => { studyClient.sample(Date.now(), false); void client.flush().catch(() => undefined); void studyClient.flush(true); };
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("ielts-studio-restores");
    if (channel) channel.onmessage = (event) => { if (event.data?.type === "studio:backup-restored") restored(); };
    window.addEventListener("studio:backup-restored", restored); window.addEventListener("pagehide", closing);
    window.addEventListener("focus", sample); window.addEventListener("blur", sample); document.addEventListener("visibilitychange", visible);
    return () => {
      disposed = true; closing(); releaseLock?.(); client.dispose(); studyClient.dispose(); window.clearInterval(interval); window.speechSynthesis?.cancel(); channel?.close();
      window.removeEventListener("studio:backup-restored", restored); window.removeEventListener("pagehide", closing);
      window.removeEventListener("focus", sample); window.removeEventListener("blur", sample); document.removeEventListener("visibilitychange", visible);
    };
  }, [client, studyClient]);

  const { words, session, mode, clock, busy, ready, pending, pendingOperation, view } = state;
  const locked = busy || !ready || Boolean(pending || pendingOperation) || courseBusy || studyState.busy;
  const study = studyState.study;
  const active = session?.status === "active";
  const displaySession = busy && state.transitionSession ? state.transitionSession : session;
  const displayMode = busy && state.transitionSession ? state.transitionSession.state.mode : mode;
  const current = active ? displaySession?.state.current ?? null : null;
  const word = current ? words.find((item) => item.id === current.wordId && item.reviewVersion === current.wordVersion) : undefined;
  const due = vocabularyReviewQueue(words.filter((item) => !isVocabularyNew(item)), clock, new Set(active ? session.state.skippedIds : []));
  const legacyNextDue = words.filter((item) => !isVocabularyNew(item) && Date.parse(item.dueAt) > clock && !session?.state.skippedIds.includes(item.id)).sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))[0]?.dueAt;
  const dueCount = state.queuePreview?.scheduledDue ?? due.length;
  const nextDue = state.queue?.nextDueAt ?? [state.queuePreview ? state.queuePreview.nextScheduledAt : legacyNextDue,
    mode === "context" ? state.targetCounts?.nextConsolidationAt : null].filter((date): date is string => Boolean(date)).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  const today = (study?.todaySeconds ?? 0) + studyState.unsavedSeconds;
  const notice = vocabularyNotice(state.message);
  const courseNotice = vocabularyNotice(courseMessage);
  async function manage(view: "courses" | "library", editing?: VocabularyEntry | "new") {
    setMoreOpen(false);
    studyClient.sample(Date.now(), false); void studyClient.flush(true);
    await client.enterManagement(view);
    if (client.getSnapshot().view === view) { setEditor(editing ?? null); setImporting(false); setCourseMessage(""); }
  }
  async function save(data: Record<string, string | string[]>, id?: string) {
    const editing = id && editor && editor !== "new" && editor.id === id ? editor : undefined;
    if (id && !editing) return;
    if (await client.saveWord(data, editing)) setEditor(null);
  }
  async function chooseCourse(courseId: string | null, startRank = 1) {
    setCourseBusy(true); setCourseMessage("");
    try {
      const response = await fetch("/api/vocabulary/courses", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseId, startRank, restoreVersion: study?.restoreVersion }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "课程设置尚未保存。");
      await studyClient.refresh(); setCourseMessage(courseId ? "新增课程已开启。返回学习后可开始，原有到期词仍优先。" : "已暂停新增词，原有到期词继续复习。");
    } catch (error) { await studyClient.refresh(); setCourseMessage(error instanceof Error ? error.message : "课程设置尚未保存，请重试。"); throw error; }
    finally { setCourseBusy(false); }
  }
  async function start() {
    if (study?.paused) await studyClient.configure({ paused: false });
    const currentStudy = studyClient.getSnapshot().study;
    if (currentStudy && !currentStudy.paused) await client.startRound(undefined, currentStudy.restoreVersion);
  }
  async function pause() { studyClient.sample(Date.now(), false); window.speechSynthesis?.cancel(); await studyClient.configure({ paused: !study?.paused }); }
  async function end() { await manage("library"); client.returnToReview(); }
  async function changeFocus(focus: VocabularyFocus) {
    if (focus === study?.focus || locked) return;
    await manage("library"); await studyClient.configure({ focus }); await client.refresh(); client.returnToReview();
  }
  function knowTarget() {
    if (!current?.target || current.targetStateVersion === undefined || !current.restoreVersion) return;
    void client.disposition({ action: "know-target", targetId: current.target.id, targetVersion: current.target.version,
      expectedStateVersion: current.targetStateVersion, restoreVersion: current.restoreVersion });
  }
  function pauseTerm() {
    if (!word || !study) return;
    const term = current?.target?.normalizedTerm ?? normaliseVocabularyAnswer(word.term);
    const disposition = state.termDispositions.find((item) => item.normalizedTerm === term);
    void client.disposition({ action: "pause-term", term, expectedStateVersion: disposition?.version ?? 0,
      restoreVersion: current?.restoreVersion ?? study.restoreVersion });
  }

  return <div className={ui.page} data-no-vocabulary>
    <h1 className={styles.visuallyHidden}>词汇学习</h1>
    <div className={styles.compactToolbar}>
      <nav className={styles.compactTabs} aria-label="词汇工作区"><button type="button" aria-pressed={view === "review"} disabled={locked} onClick={() => { setMoreOpen(false); client.returnToReview(); setEditor(null); }}>学习</button><button type="button" aria-pressed={view === "courses"} disabled={locked} onClick={() => void manage("courses")}>课程</button><button type="button" aria-pressed={view === "library"} disabled={locked} onClick={() => void manage("library")}>词库</button></nav>
      <div className={styles.compactActions}><span className={styles.compactTime}>今日学习 <strong>{elapsedLabel(today)}</strong></span><button type="button" className={ui.buttonSecondary} disabled={locked || !studyState.ready} onClick={() => void pause()}>{study?.paused ? "继续学习" : "暂停"}</button><button ref={moreButton} type="button" className={ui.buttonSecondary} aria-haspopup="dialog" aria-controls="vocabulary-more" aria-expanded={moreOpen} aria-label={state.conflicted ? "更多，含1份保留回答" : "更多"} onClick={() => setMoreOpen(true)}>更多{state.conflicted && <span className={styles.retainedDot} aria-hidden="true" />}</button></div>
    </div>
    <span className={styles.visuallyHidden} role="status">{notice?.kind === "success" ? notice.text : ""}</span>
    <div className={styles.workspaceFeedback}>
      {notice?.kind === "attention" && <div role="alert" className={ui.notice}>{notice.text}</div>}
      {studyState.message && <div role="alert" className={ui.notice}>{studyState.message}<button type="button" className={ui.buttonSecondary} disabled={studyState.busy} onClick={() => void studyClient.initialize()}>重试同步时间</button></div>}
      {courseMessage && (view !== "review" || courseNotice?.kind === "attention") && <div role="status" className={ui.notice}>{courseMessage}</div>}
    {pending && !busy && <div className={styles.pendingActions} role="alert"><p>保存结果需要核对，当前回答已保留。</p><button className={ui.buttonSecondary} onClick={() => void client.verifyPending()}>核对保存状态</button><button className={ui.button} onClick={() => void client.retryReview()}>{pending.supplemental ? "重试保存练习结果" : "重试保存原评分"}</button></div>}
    {pendingOperation && !busy && <div className={styles.pendingActions} role="alert"><p>学习选择的保存状态需要核对，原操作已保留。</p><button className={ui.buttonSecondary} onClick={() => void client.verifyPending()}>核对保存状态</button><button className={ui.button} onClick={() => void client.retryOperation()}>重试原学习选择</button></div>}
    </div>
    {!ready ? <section className={ui.empty}><p>正在恢复学习轮和当前题目。</p><button className={ui.buttonSecondary} disabled={busy} onClick={() => void client.refresh()}>重试读取</button></section>
      : view === "courses" ? <VocabularyCourses key={managementRevision} activeCourseId={study?.activeCourseId ?? null} startRank={study?.startRank ?? 1} busy={locked} onSelect={chooseCourse} onDisposition={(input) => client.disposition(input)} />
      : view === "library" ? <div className={ui.stack}><VocabularyTargets key={`targets:${managementRevision}`} busy={locked} onAction={(input) => client.disposition(input)} /><div className={styles.managementActions}><button type="button" className={ui.buttonSecondary} disabled={locked} onClick={() => setEditor("new")}>＋ 添加个人词条</button><button type="button" className={ui.buttonSecondary} disabled={locked} onClick={() => setImporting((value) => !value)}>导入 TXT / CSV / Excel</button></div>{importing && <VocabularyImportPanel key={managementRevision} onClose={() => setImporting(false)} onImported={() => { void client.refresh(); }} />}<VocabularyLibrary key={managementRevision} words={words} clock={clock} busy={locked} editor={editor} onEdit={setEditor} onSave={save} /></div>
      : <div className={styles.reviewWorkspace}>
        {study?.paused ? <section className={`${ui.panel} ${styles.card}`} aria-label="学习已暂停"><div className={styles.front}><h2>休息一下，答案已保留</h2><p>继续后回到当前题目。</p><button type="button" className={ui.button} disabled={locked} onClick={() => void pause()}>继续学习</button></div></section>
          : word && current ? current.phase === "learn" ? <VocabularyLearningCard key={`${word.id}:${word.reviewVersion}:${current.target?.id ?? "word"}:${current.startedAt}`} word={word} exercise={current.exercise} draft={current} busy={locked} onLearn={() => void client.learnWord(word)} onEdit={() => void manage("library", current.target ? undefined : word)} onSkip={() => void client.skipCard()} onKnowTarget={current.target ? knowTarget : undefined} onPauseTerm={pauseTerm} />
            : <VocabularyReviewCard key={`${word.id}:${word.reviewVersion}:${displayMode}:${current.target?.id ?? "word"}:${current.exercise?.id ?? "personal"}:${current.startedAt}`} word={word} mode={displayMode} draft={current} sessionId={session!.id} sessionRevision={session!.revision} busy={locked} onDraftChange={(changes) => client.changeDraft(changes)} onReview={(reviewed, input) => void client.reviewWord(reviewed, input)} onEdit={() => void manage("library", current.target ? undefined : word)} onSkip={() => void client.skipCard()} onRefresh={() => void client.refresh()} onKnowTarget={current.target ? knowTarget : undefined} onPauseTerm={pauseTerm} />
          : <section className={`${ui.panel} ${styles.card}`} aria-label="学习轮状态"><div className={styles.front}><h2>{current ? "当前词卡需要同步" : !active ? "准备开始学习" : state.nextError ? "下一题暂未读取" : state.queue?.status === "waiting" ? "等待下一次复习" : "本轮暂时没有可练词"}</h2><p>{current ? "资料或复习安排已更新，旧答案尚未评分。" : !active ? "到期词优先，新词先学习。" : state.nextError ? state.nextError : state.queue?.reason === "no-course" ? "新增词已暂停；已学词到期后会自动出现，也可以选择一门课程继续。" : state.queue?.reason === "deferred" ? "当前可练词已在本轮暂缓。可结束本轮，稍后开始新一轮。" : state.queue?.reason === "no-eligible-content" ? "当前筛选下暂无可练内容，请选择其他课程或核对学习设置。" : "已学词到期后会自动进入本轮。"}</p>{active && !current && state.checkingNext && <p role="status">正在检查可练内容…</p>}{nextDue && <p>下次到期：<time dateTime={nextDue}>{new Date(nextDue).toLocaleString("zh-CN")}</time>{active && !current && Date.parse(nextDue) > clock && <span> · 还有 {elapsedLabel(Math.ceil((Date.parse(nextDue) - clock) / 1000))}</span>}</p>}<div className={styles.cardActions}>{active && !current && state.nextError && <button type="button" className={ui.buttonSecondary} disabled={locked || state.checkingNext} onClick={() => void client.retryNextCard()}>重试读取下一题</button>}{current ? <button type="button" className={ui.button} disabled={locked} onClick={() => void client.refresh()}>同步词卡</button> : !active && <button type="button" className={ui.button} disabled={locked || !studyState.ready} onClick={() => void start()}>开始学习</button>}<button type="button" className={ui.buttonSecondary} disabled={locked} onClick={() => void manage("courses")}>选择 / 核对课程</button></div></div></section>}
      </div>}
    <VocabularyMorePanel open={moreOpen} onClose={() => setMoreOpen(false)} triggerRef={moreButton} state={state} studyState={studyState} locked={locked} dueCount={dueCount} today={today} successMessage={notice?.kind === "success" ? notice.text : courseNotice?.kind === "success" ? courseNotice.text : undefined} attentionMessage={notice?.kind === "attention" ? notice.text : courseNotice?.kind === "attention" ? courseNotice.text : undefined}
      onMode={(mode) => void client.changeMode(mode)} onFocus={(focus) => void changeFocus(focus)} onGoal={(minutes) => void studyClient.configure({ dailyGoalSeconds: minutes * 60 })} onClearAnswer={() => client.clearConflicted()} onEnd={() => void end()} onRetryTime={() => void studyClient.initialize()} />
  </div>;
}
