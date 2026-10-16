"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { normaliseVocabularyAnswer, type VocabularyEntry } from "@/lib/vocabulary";
import type { VocabularyFocus } from "@/lib/vocabulary-target";
import { VocabularySessionClient } from "@/lib/vocabulary-session-client";
import { VocabularyStudyClient } from "@/lib/vocabulary-study-client";
import { isVocabularyNew, vocabularyReviewQueue } from "@/lib/vocabulary-practice";
import { VocabularyLibrary } from "./vocabulary-library";
import { VocabularyCourses } from "./vocabulary-courses";
import { VocabularyImportPanel } from "./vocabulary-import-panel";
import { VocabularyReviewCard, vocabularyModes } from "./vocabulary-review-card";
import { VocabularyLearningCard } from "./vocabulary-learning-card";
import { VocabularyTargets } from "./vocabulary-targets";
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
    const restored = () => { client.resetAfterRestore(); studyClient.resetAfterRestore(); setEditor(null); setImporting(false); setManagementRevision((value) => value + 1); };
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
  const current = active ? session.state.current : null;
  const word = current ? words.find((item) => item.id === current.wordId && item.reviewVersion === current.wordVersion) : undefined;
  const due = vocabularyReviewQueue(words.filter((item) => !isVocabularyNew(item)), clock, new Set(active ? session.state.skippedIds : []));
  const legacyNextDue = words.filter((item) => !isVocabularyNew(item) && Date.parse(item.dueAt) > clock && !session?.state.skippedIds.includes(item.id)).sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))[0]?.dueAt;
  const dueCount = state.queuePreview?.scheduledDue ?? due.length;
  const nextDue = [state.queuePreview ? state.queuePreview.nextScheduledAt : legacyNextDue,
    mode === "context" ? state.targetCounts?.nextConsolidationAt : null].filter((date): date is string => Boolean(date)).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  const today = (study?.todaySeconds ?? 0) + studyState.unsavedSeconds;
  const goal = study?.dailyGoalSeconds ?? 900;
  async function manage(view: "courses" | "library", editing?: VocabularyEntry | "new") {
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
    <header className={ui.pageHeader}><div><p className={ui.eyebrow}>Vocabulary / Daily Practice</p><h1>词汇学习</h1><p>在语境里学习具体用法。保留熟词的进阶义，按自己的节奏继续。</p></div></header>
    <nav className={styles.viewTabs} aria-label="词汇工作区"><button type="button" aria-pressed={view === "review"} disabled={locked} onClick={() => { client.returnToReview(); setEditor(null); }}>学习</button><button type="button" aria-pressed={view === "courses"} disabled={locked} onClick={() => void manage("courses")}>课程</button><button type="button" aria-pressed={view === "library"} disabled={locked} onClick={() => void manage("library")}>词库</button><span className={styles.saveState} role="status">{!ready ? "正在读取学习记录…" : state.saving ? "正在保存本轮状态…" : "草稿自动保存"}</span></nav>
    {state.message && <div role="status" className={ui.notice}>{state.message}</div>}
    {state.conflicted && <aside className={styles.retainedAnswer} aria-label="保留的旧题回答"><p>题目或学习轮已变化，上次输入已单独保留，不会自动提交或用于新题判分。</p><details><summary>查看保留的原回答</summary><label className={ui.field}><span>你当时输入的内容</span><textarea className={ui.input} rows={2} readOnly value={state.conflicted.card.answer} aria-label="保留的原回答" /></label>{state.conflicted.card.gaveUp && <p>当时选择了“想不起来”。</p>}</details><button type="button" className={ui.buttonGhost} onClick={() => client.clearConflicted()}>清除保留回答</button></aside>}
    {courseMessage && <div role="status" className={ui.notice}>{courseMessage}</div>}
    {pending && !busy && <div className={styles.pendingActions} role="alert"><p>保存结果需要核对，当前回答已保留。</p><button className={ui.buttonSecondary} onClick={() => void client.verifyPending()}>核对保存状态</button><button className={ui.button} onClick={() => void client.retryReview()}>{pending.supplemental ? "重试保存练习结果" : "重试保存原评分"}</button></div>}
    {pendingOperation && !busy && <div className={styles.pendingActions} role="alert"><p>学习选择的保存状态需要核对，原操作已保留。</p><button className={ui.buttonSecondary} onClick={() => void client.verifyPending()}>核对保存状态</button><button className={ui.button} onClick={() => void client.retryOperation()}>重试原学习选择</button></div>}
    {!ready ? <section className={ui.empty}><p>正在恢复学习轮和当前题目。</p><button className={ui.buttonSecondary} disabled={busy} onClick={() => void client.refresh()}>重试读取</button></section>
      : view === "courses" ? <VocabularyCourses key={managementRevision} activeCourseId={study?.activeCourseId ?? null} startRank={study?.startRank ?? 1} busy={locked} onSelect={chooseCourse} onDisposition={(input) => client.disposition(input)} />
      : view === "library" ? <div className={ui.stack}><VocabularyTargets key={`targets:${managementRevision}`} busy={locked} onAction={(input) => client.disposition(input)} /><div className={styles.managementActions}><button type="button" className={ui.buttonSecondary} disabled={locked} onClick={() => setEditor("new")}>＋ 添加个人词条</button><button type="button" className={ui.buttonSecondary} disabled={locked} onClick={() => setImporting((value) => !value)}>导入 TXT / CSV / Excel</button></div>{importing && <VocabularyImportPanel key={managementRevision} onClose={() => setImporting(false)} onImported={() => { void client.refresh(); }} />}<VocabularyLibrary key={managementRevision} words={words} clock={clock} busy={locked} editor={editor} onEdit={setEditor} onSave={save} /></div>
      : <div className={styles.reviewWorkspace}>
        <details className={styles.studySettings}><summary>学习设置 · {study?.activeCourseTitle || "课程与学习侧重"}</summary><section className={styles.focusPanel} aria-label="学习侧重"><label className={ui.field}><span>学习侧重</span><select className={ui.input} disabled={locked || !studyState.ready} value={study?.focus ?? "ielts-advanced"} onChange={(event) => void changeFocus(event.target.value as VocabularyFocus)}><option value="ielts-advanced">雅思实用进阶 · 默认</option><option value="general">完整通用课程</option></select></label><p><strong>{study?.activeCourseTitle ? `新增课程：${study.activeCourseTitle}` : studyState.ready ? study?.activeCourseId ? "已选择新增课程" : "已暂停新增词" : "正在读取课程设置…"}</strong><br />{study?.focus === "general" ? "保留通用课程与原有学习记录。切换侧重会结束当前轮，不给未提交卡评分。" : "新增用法按 B2 / C1 交替均衡安排。简单用法暂停后保留进度；熟词的新义先介绍，再做语境巩固。"}</p></section></details>
        <section className={styles.studyGoal} aria-label="每日学习目标"><div><p>今日有效学习 <strong>{elapsedLabel(today)}</strong> / {Math.round(goal / 60)} 分钟</p><progress max={goal} value={Math.min(goal, today)} aria-label="每日有效学习时间" /><small>{today >= goal ? "今日目标已达到，可继续自由学习。" : study?.paused ? "已暂停，保留当前卡和答案。" : "前台学习时累计，隐藏页面或暂停时停止计时。"}</small></div><div className={styles.goalActions}><button type="button" className={ui.buttonSecondary} disabled={locked || !studyState.ready} onClick={() => void pause()}>{study?.paused ? "继续学习" : "暂停"}</button>{active && <button type="button" className={ui.buttonGhost} disabled={locked} onClick={() => void end()}>结束本轮</button>}<details><summary>调整每日目标</summary><form key={goal} onSubmit={(event) => { event.preventDefault(); const minutes = Number(new FormData(event.currentTarget).get("minutes")); if (Number.isInteger(minutes) && minutes >= 1 && minutes <= 360) void studyClient.configure({ dailyGoalSeconds: minutes * 60 }); }}><label className={ui.field}><span>每天分钟数</span><input className={ui.input} name="minutes" type="number" min={1} max={360} step={1} defaultValue={Math.round(goal / 60)} required disabled={locked} /></label><button type="submit" className={ui.buttonSecondary} disabled={locked}>保存目标</button></form></details></div></section>
        {studyState.message && <div className={ui.notice} role="status">{studyState.message}<button type="button" className={ui.buttonGhost} disabled={studyState.busy} onClick={() => void studyClient.initialize()}>重试同步时间</button></div>}
        <div className={styles.reviewToolbar}><dl className={styles.progressStrip} aria-label="本轮进度"><div><dt>到期复习</dt><dd>{dueCount} 个</dd></div><div><dt>已评分</dt><dd>{active ? session.state.reviewed : 0} 次</dd></div><div><dt>学习 / 介绍</dt><dd>{active ? session.state.learned : 0} 个</dd></div><div><dt>本轮暂缓</dt><dd>{active ? session.state.skippedIds.length : 0} 个</dd></div></dl><details className={styles.extraStats}><summary>更多学习统计</summary><dl className={styles.progressStrip}><div><dt>用法巩固到期</dt><dd>{state.targetCounts?.consolidationDue ?? 0} 个</dd></div><div><dt>辅助练习</dt><dd>{active ? session.state.supplementalReviewed ?? 0 : 0} 次</dd></div><div><dt>自报用法已会</dt><dd>{state.targetCounts?.pausedTargets ?? 0} 个</dd></div><div><dt>整词暂停</dt><dd>{state.targetCounts?.pausedTerms ?? 0} 个</dd></div></dl></details><details className={styles.specialModes}><summary>练习方式 · {vocabularyModes.find((item) => item.value === mode)?.label}</summary><div className={styles.modes} aria-label="复习模式">{vocabularyModes.map((item) => <button key={item.value} type="button" aria-pressed={mode === item.value} disabled={locked || Boolean(study?.paused)} className={mode === item.value ? styles.activeMode : ""} onClick={() => void client.changeMode(item.value)}>{item.label}</button>)}</div><p className={styles.small}>语境填词为主流程。切换方式暂缓整个词，不给未提交卡评分；新用法的分钟级巩固只在语境模式进行。</p></details></div>
        {study?.paused ? <section className={`${ui.panel} ${styles.card}`} aria-label="学习已暂停"><div className={styles.front}><h2>休息一下，答案已保留</h2><p>继续后回到当前题目，暂停时间不计入今日学习。</p><button type="button" className={ui.button} disabled={locked} onClick={() => void pause()}>继续学习</button></div></section>
          : word && current ? current.phase === "learn" ? <VocabularyLearningCard key={`${word.id}:${word.reviewVersion}:${current.target?.id ?? "word"}:${current.startedAt}`} word={word} exercise={current.exercise} draft={current} busy={locked} onLearn={() => void client.learnWord(word)} onEdit={() => void manage("library", current.target ? undefined : word)} onSkip={() => void client.skipCard()} onKnowTarget={current.target ? knowTarget : undefined} onPauseTerm={pauseTerm} />
            : <VocabularyReviewCard key={`${word.id}:${word.reviewVersion}:${mode}:${current.target?.id ?? "word"}:${current.exercise?.id ?? "personal"}:${current.startedAt}`} word={word} mode={mode} draft={current} sessionId={session!.id} sessionRevision={session!.revision} busy={locked} onDraftChange={(changes) => client.changeDraft(changes)} onReview={(reviewed, input) => void client.reviewWord(reviewed, input)} onEdit={() => void manage("library", current.target ? undefined : word)} onSkip={() => void client.skipCard()} onRefresh={() => void client.refresh()} onKnowTarget={current.target ? knowTarget : undefined} onPauseTerm={pauseTerm} />
          : <section className={`${ui.panel} ${styles.card}`} aria-label="学习轮状态"><div className={styles.front}><h2>{current ? "当前词卡需要同步" : !active ? "准备开始学习" : busy ? "正在读取下一题" : "本轮暂时没有可练词"}</h2><p>{current ? "资料或复习安排已更新，旧答案尚未评分。" : !active ? "新词先学习，再安排首次回忆；已学到期词优先，新增数量不限。" : "到期词会进入本轮。选择可练课程可继续新增词，待核对资料需先发布。"}</p>{nextDue && <p>下次到期：<time dateTime={nextDue}>{new Date(nextDue).toLocaleString("zh-CN")}</time></p>}<div className={styles.cardActions}>{current ? <button type="button" className={ui.button} disabled={locked} onClick={() => void client.refresh()}>同步词卡</button> : !active && <button type="button" className={ui.button} disabled={locked || !studyState.ready} onClick={() => void start()}>开始学习</button>}<button type="button" className={ui.buttonSecondary} disabled={locked} onClick={() => void manage("courses")}>选择 / 核对课程</button></div></div></section>}
        <details className={styles.memoryPlan}><summary>复习安排 · FSRS 目标保持率 90%</summary><p>每个词共用复习进度。真正的新词先学习，再按原步骤回忆；熟词的新用法先介绍，1 分钟、10 分钟语境巩固只记录辅助练习，不改变原 FSRS。</p><p>正式到期与用法巩固合并出现时只评分一次，不再增加一份辅助样本。支持的语境题可选择“继续并再练一句”，追加练习单独统计。</p><p>“这个用法已会”是自报选择，整词暂停适用于所有课程，均不伪造评分。每日时间是软目标。90% 是间隔安排的目标，不是实测成绩。</p></details>
      </div>}
  </div>;
}
