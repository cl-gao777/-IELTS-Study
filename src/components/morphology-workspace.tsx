"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { MorphologyCoursesResponse, MorphologyLesson, MorphologyWorkspace as Workspace } from "@/lib/morphology";
import { MorphologyClient } from "@/lib/morphology-client";
import { MorphologyStudyClock } from "@/lib/morphology-time-client";
import { MorphologyCatalogue, MorphologyHistoryView, morphologyElapsed, morphologyTitle } from "./morphology-catalogue";
import { MorphologyLessonContent } from "./morphology-lesson";
import { MorphologyPractice, MorphologyResults } from "./morphology-practice";
import { morphologyDisplayPhase, morphologySelectedLesson } from "./morphology-display";
import ui from "./page-ui.module.css";
import styles from "./morphology.module.css";

type View = "catalogue" | "study" | "history";
async function fetchMorphologyCourses(lessonId?: string): Promise<MorphologyCoursesResponse> {
  const response = await fetch("/api/morphology/courses" + (lessonId ? "?lessonId=" + encodeURIComponent(lessonId) : ""), { cache: "no-store" });
  const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "课程暂时无法读取。"); return payload;
}
function downloadText(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = "词根练习-保留回答.txt"; anchor.click(); URL.revokeObjectURL(url);
}
export function MorphologyWorkspace({ initialLessonId }: { initialLessonId?: string }) {
  const [client] = useState(() => new MorphologyClient()); const [initialSnapshot] = useState(client.getSnapshot);
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, () => initialSnapshot);
  const [data, setData] = useState<MorphologyCoursesResponse | null>(null); const [loadError, setLoadError] = useState("");
  const [view, setView] = useState<View>(initialLessonId ? "study" : "catalogue"); const [preview, setPreview] = useState<MorphologyLesson | null>(null);
  const [selectedLessonId, setSelectedLessonId] = useState(initialLessonId); const selectedLessonRef = useRef(initialLessonId);
  const [lessonLoading, setLessonLoading] = useState(Boolean(initialLessonId)); const lessonRequest = useRef(0);
  const [suspended, setSuspended] = useState(false); const [time, setTime] = useState({ todaySeconds: 0, totalSeconds: 0 }); const [timeMessage, setTimeMessage] = useState("");
  const viewRef = useRef<View>(view); const suspendedRef = useRef(false); const clockRef = useRef<MorphologyStudyClock | null>(null);
  useEffect(() => { viewRef.current = view; suspendedRef.current = suspended; }, [view, suspended]);
  const applyCourses = useCallback((payload: MorphologyCoursesResponse) => { const current = client.getSnapshot().workspace; if (current && current.dataEpoch !== payload.dataEpoch) client.freezeAfterRestore(); setData(payload); setLoadError(""); if (payload.lesson && payload.lesson.id === selectedLessonRef.current) setPreview(payload.lesson); }, [client]);
  const failedCourses = useCallback((error: unknown) => { setLoadError(error instanceof Error ? error.message : "课程暂时无法读取。"); }, []);
  const load = useCallback(async (lessonId?: string) => {
    const request = lessonId ? ++lessonRequest.current : 0;
    try {
      const payload = await fetchMorphologyCourses(lessonId);
      if (lessonId && (request !== lessonRequest.current || lessonId !== selectedLessonRef.current)) return;
      if (lessonId && payload.lesson?.id !== lessonId) throw new Error("所选课程资料不匹配，请重新读取。");
      applyCourses(payload);
    } catch (error) { if (!lessonId || request === lessonRequest.current && lessonId === selectedLessonRef.current) failedCourses(error); }
    finally { if (lessonId && request === lessonRequest.current && lessonId === selectedLessonRef.current) setLessonLoading(false); }
  }, [applyCourses, failedCourses]);
  useEffect(() => {
    let cancelled = false; const request = ++lessonRequest.current;
    const current = () => !cancelled && request === lessonRequest.current && initialLessonId === selectedLessonRef.current;
    void fetchMorphologyCourses(initialLessonId).then(payload => {
      if (!current()) return;
      if (initialLessonId && payload.lesson?.id !== initialLessonId) throw new Error("所选课程资料不匹配，请重新读取。");
      applyCourses(payload); setLessonLoading(false);
    }).catch(error => { if (current()) { failedCourses(error); setLessonLoading(false); } });
    return () => { cancelled = true; };
  }, [applyCourses, failedCourses, initialLessonId]);
  useEffect(() => {
    let disposed = false; let ownsTimer = !navigator.locks; let acquiring = false; let releaseLock: (() => void) | undefined;
    let lastInteraction = Date.now(); let storage: Storage | undefined; try { storage = localStorage; } catch {}
    const clock = new MorphologyStudyClock(() => {
      const current = client.getSnapshot(); const session = current.workspace?.session;
      return current.frozen || !current.workspace || !session ? null : { dataEpoch: current.workspace.dataEpoch, sessionId: session.id };
    }, async packet => {
      try {
        const response = await fetch("/api/morphology/study", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(packet) });
        const payload = await response.json(); if (response.status === 409) { client.freezeAfterRestore(); clock.stop(); }
        if (!response.ok) throw new Error(payload.error || "学习时间暂未同步。");
        setTime({ todaySeconds: payload.todaySeconds, totalSeconds: payload.totalSeconds }); setTimeMessage(""); return payload as Workspace;
      } catch (error) { setTimeMessage("学习时间尚未同步，累计片段已保存在浏览器，恢复连接后重试。"); throw error; }
    }, storage);
    clockRef.current = clock;
    void client.initialize(storage).then(async () => {
      if (disposed) return;
      const session = client.getSnapshot().workspace?.session;
      // A recovered page never resumes a clock or voice before an explicit continue.
      if (session?.status === "active") { setSuspended(true); suspendedRef.current = true; if (!session.state.paused) await client.action("pause"); }
      void clock.flush();
    });
    const engaged = () => {
      const current = client.getSnapshot(); const session = current.workspace?.session;
      return current.ready && !current.frozen && !current.pending && !current.busy && viewRef.current === "study" && !suspendedRef.current
        && session?.status === "active" && !session.state.paused && session.state.phase !== "results" && !document.hidden && document.hasFocus()
        && (Date.now() - lastInteraction < 180_000 || Boolean(window.speechSynthesis?.speaking));
    };
    const sample = () => {
      const active = engaged();
      if (!active && releaseLock) { clock.sample(Date.now(), false); void clock.flush(); releaseLock(); releaseLock = undefined; ownsTimer = false; }
      if (active && navigator.locks && !ownsTimer && !acquiring) {
        acquiring = true;
        void navigator.locks.request("ielts-vocabulary-study-timer", { ifAvailable: true }, async lock => {
          acquiring = false; if (!lock || disposed || !engaged()) return; ownsTimer = true;
          await new Promise<void>(resolve => { releaseLock = resolve; }); ownsTimer = false;
        }).catch(() => { acquiring = false; });
      }
      clock.sample(Date.now(), Boolean(active && ownsTimer));
    };
    const touch = () => { lastInteraction = Date.now(); sample(); };
    const suspend = () => {
      clock.sample(Date.now(), false); void clock.flush(); window.speechSynthesis?.cancel();
      const session = client.getSnapshot().workspace?.session;
      if (session?.status === "active" && viewRef.current === "study") { suspendedRef.current = true; setSuspended(true); if (!session.state.paused) void client.action("pause"); }
    };
    const visible = () => { if (document.hidden) suspend(); else { sample(); void client.refresh(); } };
    const closing = () => { suspend(); void client.flush(); };
    const restored = () => { clock.sample(Date.now(), false); clock.stop(); releaseLock?.(); client.freezeAfterRestore(); window.speechSynthesis?.cancel(); };
    const interval = window.setInterval(sample, 1000); const sync = window.setInterval(() => { void clock.flush().catch(() => setTimeMessage("学习时间尚未同步，已保留本地片段。")); }, 10_000);
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("ielts-studio-restores"); if (channel) channel.onmessage = event => { if (event.data?.type === "studio:backup-restored") restored(); };
    window.addEventListener("studio:backup-restored", restored); window.addEventListener("pagehide", closing); window.addEventListener("blur", suspend); window.addEventListener("focus", touch);
    document.addEventListener("visibilitychange", visible); window.addEventListener("keydown", touch); window.addEventListener("pointerdown", touch); window.addEventListener("scroll", touch, true);
    return () => {
      disposed = true; clock.sample(Date.now(), false); void clock.flush().finally(() => clock.stop()); void client.flush(); client.dispose(); releaseLock?.(); window.speechSynthesis?.cancel(); channel?.close();
      window.clearInterval(interval); window.clearInterval(sync); clockRef.current = null;
      window.removeEventListener("studio:backup-restored", restored); window.removeEventListener("pagehide", closing); window.removeEventListener("blur", suspend); window.removeEventListener("focus", touch);
      document.removeEventListener("visibilitychange", visible); window.removeEventListener("keydown", touch); window.removeEventListener("pointerdown", touch); window.removeEventListener("scroll", touch, true);
    };
  }, [client]);
  const session = state.workspace?.session; const active = session?.status === "active"; const phase = session?.state.phase;
  useEffect(() => { if (state.frozen) { clockRef.current?.sample(Date.now(), false); clockRef.current?.stop(); window.speechSynthesis?.cancel(); } }, [state.frozen]);
  useEffect(() => { if (phase === "results") void fetchMorphologyCourses().then(applyCourses).catch(failedCourses); }, [phase, applyCourses, failedCourses]);
  const lesson = morphologySelectedLesson(selectedLessonId, preview, session, lessonLoading);
  const studyingCurrent = view === "study" && Boolean(session && lesson?.id === session.state.lesson.id);
  const displayPhase = morphologyDisplayPhase(session, studyingCurrent);
  const activePractice = active && phase === "practice";
  const locked = state.busy || !state.ready || state.frozen || Boolean(state.pending);
  const paused = studyingCurrent && active && (session.state.paused || suspended);
  async function pause() { clockRef.current?.sample(Date.now(), false); void clockRef.current?.flush(); window.speechSynthesis?.cancel(); suspendedRef.current = true; setSuspended(true); await client.action("pause"); }
  async function resume() { await client.action("resume"); const current = client.getSnapshot(); if (!current.frozen && !current.pending && current.workspace?.session?.status === "active") { const resumed = current.workspace.session.state.lesson; ++lessonRequest.current; selectedLessonRef.current = resumed.id; setSelectedLessonId(resumed.id); setPreview(resumed); setLessonLoading(false); suspendedRef.current = false; setSuspended(false); setView("study"); } }
  async function navigate(next: View) {
    if (active) await pause(); setView(next); if (next !== "study") void load();
  }
  function openLesson(lessonId: string) { if (lessonId !== initialLessonId) return; selectedLessonRef.current = lessonId; setSelectedLessonId(lessonId); setLessonLoading(true); setPreview(null); setView("study"); void load(lessonId); }
  async function end() { clockRef.current?.sample(Date.now(), false); await clockRef.current?.flush(); window.speechSynthesis?.cancel(); await client.action("end"); if (!client.getSnapshot().frozen) { setSuspended(false); suspendedRef.current = false; setView("catalogue"); void load(); } }
  async function start(retry: "initial" | "whole" | "weak" = "initial") {
    if (!lesson || lessonLoading || selectedLessonRef.current && lesson.id !== selectedLessonRef.current) return; window.speechSynthesis?.cancel(); await client.start(lesson.id, lesson.version, retry);
    if (client.getSnapshot().workspace?.session?.status === "active" && !client.getSnapshot().frozen) { setView("study"); suspendedRef.current = false; setSuspended(false); }
  }
  const todaySeconds = Math.max(time.todaySeconds, data?.todaySeconds ?? 0, state.workspace?.todaySeconds ?? 0);
  return <div className={`${ui.page} ${styles.workspace}`} data-no-vocabulary>
    <header className={ui.pageHeader}><div><p className={ui.eyebrow}>Word Formation / Independent Course</p><h1>词根词缀</h1><p>从构词部件理解一组单词，再在语境中运用。按自己的节奏学习，不设到期任务。</p></div></header>
    <nav className={styles.tabs} aria-label="词根词缀工作区"><button className={ui.buttonSecondary} type="button" aria-pressed={view === "catalogue"} disabled={state.busy || Boolean(state.pending)} onClick={() => void navigate("catalogue")}>课程目录</button><button className={ui.buttonSecondary} type="button" aria-pressed={view === "study"} disabled={!lesson || state.busy || Boolean(state.pending)} onClick={() => setView("study")}>本课学习</button><button className={ui.buttonSecondary} type="button" aria-pressed={view === "history"} disabled={state.busy || Boolean(state.pending)} onClick={() => void navigate("history")}>学习记录</button></nav>
    <div className={styles.toolbar}><p className={styles.small}>今日词根学习 {morphologyElapsed(todaySeconds)} · 计入首页总时长，不占原词汇时间目标</p><span className={styles.small} role="status">{state.frozen ? "旧页面已冻结" : state.saving ? "正在保存输入…" : state.busy ? "正在同步…" : "草稿自动保存"}</span></div>
    {(state.message || loadError || timeMessage) && <p className={state.frozen ? ui.error : ui.notice} role="status">{state.message || loadError || timeMessage}</p>}
    {state.retainedInput && <aside className={styles.retained}><details><summary>查看保留的未保存回答</summary><label className={ui.field}>原回答<textarea className={ui.textarea} readOnly value={state.retainedInput} /></label><div className={styles.actions}><button type="button" className={ui.buttonSecondary} onClick={() => downloadText(state.retainedInput)}>导出原回答</button><button type="button" className={ui.buttonSecondary} onClick={() => client.clearRetained()}>清除保留副本</button></div></details></aside>}
    {state.frozen && <div className={ui.notice}><p>请先复制或导出需要保留的输入，再刷新本页。</p><div className={styles.actions}><button type="button" className={ui.buttonSecondary} onClick={() => window.location.reload()}>刷新本页</button>{state.message.includes("课程内容已更新") && <button type="button" className={ui.buttonSecondary} onClick={() => { void client.endStaleRound().then(ended => { if (ended) window.location.reload(); }); }}>结束旧练习并重新载入</button>}</div></div>}
    {state.pending && !state.frozen && <section className={ui.notice} role="alert"><p>提交结果尚待核对，原回答和提交编号已保留。核对前不进入下一题。</p><div className={styles.actions}><button type="button" className={ui.buttonSecondary} disabled={state.busy} onClick={() => void client.verifyPending()}>核对保存状态</button><button type="button" className={ui.button} disabled={state.busy || !state.verifiedMissing} onClick={() => void client.retryPending()}>重试原提交</button></div></section>}
    {!state.ready || (!data && !loadError) ? <section className={ui.empty}>正在读取课程与练习状态…</section>
      : !state.workspace || !data ? <section className={ui.empty}><p>暂时无法读取学习资料。</p><button type="button" className={ui.buttonSecondary} onClick={() => { void client.initialize(); void load(initialLessonId); }}>重试读取</button></section>
        : (view !== "study" || !studyingCurrent) && activePractice ? <section className={styles.resume}><p>进行中的练习已保存。为避免提前看到答案，继续本轮或结束本轮后再查看完整目录与记录。</p><div className={styles.actions}><button type="button" className={ui.button} disabled={locked} onClick={() => { setPreview(session.state.lesson); void resume(); }}>继续本轮</button><button type="button" className={ui.buttonSecondary} disabled={locked} onClick={() => void end()}>结束本轮，返回目录</button></div></section>
          : view === "catalogue" ? <>{active && <section className={styles.resume}><p>有一课尚未结束：{session.state.lesson.form}</p><div className={styles.actions}><button className={ui.button} type="button" disabled={locked} onClick={() => void resume()}>继续本课</button><button className={ui.buttonSecondary} type="button" disabled={locked} onClick={() => void end()}>结束本轮</button></div></section>}<MorphologyCatalogue data={data} onOpen={openLesson} /></>
            : view === "history" ? <MorphologyHistoryView data={data} onOpen={openLesson} />
              : !lesson ? <p className={ui.empty}>{lessonLoading ? "正在读取所选课程…" : loadError ? "所选课程尚未载入，请返回目录重新打开。" : "请先从课程目录选择一课。"}</p>
                : paused && session ? <section className={ui.panel}><p className={ui.eyebrow}>本轮已暂停</p><h2>{session.state.lesson.form}</h2><p>题目、输入和进度已保留。继续前不会计时或播放声音。</p><div className={styles.actions}><button type="button" className={ui.button} disabled={locked} onClick={() => void resume()}>继续本轮</button><button type="button" className={ui.buttonSecondary} disabled={locked} onClick={() => void end()}>结束本轮</button></div></section>
                  : session && displayPhase === "practice" ? <><div className={styles.toolbar}><p className={styles.small}>{session.state.lesson.form} · 构词练习</p><button type="button" className={ui.buttonSecondary} disabled={locked} onClick={() => void pause()}>暂停</button></div><MorphologyPractice client={client} state={state} /></>
                    : session && displayPhase === "results" ? <MorphologyResults session={session} busy={locked} onRetry={kind => void start(kind)} />
                      : <section className={ui.panel} aria-label="词根词缀教学">{active && studyingCurrent ? <MorphologyLessonContent lesson={lesson} dataEpoch={state.workspace.dataEpoch} disabled={locked} onStale={message => client.freezeForConflict(message)} /> : <><p className={ui.eyebrow}>词群小课</p><h2>{morphologyTitle(lesson.form, lesson.titleZh)}</h2><p>{lesson.overviewZh}</p><p>本课包含 {lesson.words.length} 个关联词，先学习构词与例句，再开始练习。点击开始后记录教学进度与活动学习时间。</p></>}
                        <div className={styles.bottomActions}><p className={styles.small}>教学和课程练习不会改变单词 FSRS。只有主动加入的关联词进入原词汇学习。</p><div className={styles.actions}>{active && !studyingCurrent ? <button type="button" className={ui.buttonSecondary} disabled={locked} onClick={() => void end()}>先结束正在进行的课程</button> : active ? <><button type="button" className={ui.buttonSecondary} disabled={locked} onClick={() => void pause()}>暂停</button><button type="button" className={ui.button} disabled={locked} onClick={() => { window.speechSynthesis?.cancel(); void client.action("practice"); }}>理解了，开始练习</button></> : <button type="button" className={ui.button} disabled={locked || lessonLoading} onClick={() => void start(data.courses.find(course => course.id === lesson.id)?.progress?.completedAt ? "whole" : "initial")}>开始本课学习</button>}</div></div>
                      </section>}
  </div>;
}
