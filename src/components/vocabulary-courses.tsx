"use client";

import { useEffect, useState } from "react";
import type { VocabularyCoursesResponse, VocabularyCourseSummary } from "@/lib/vocabulary-course";
import type { VocabularyDispositionOperation } from "@/lib/vocabulary-target";
import { VocabularyAssessmentPanel } from "./vocabulary-assessment-panel";
import { VocabularyCourseEntries } from "./vocabulary-course-entries";
import { VocabularyTargets } from "./vocabulary-targets";
import ui from "./page-ui.module.css";
import styles from "./vocabulary.module.css";

export function VocabularyCourses({ activeCourseId, startRank, busy, onSelect, onDisposition }: { activeCourseId: string | null; startRank: number; busy: boolean; onSelect: (courseId: string | null, startRank?: number) => Promise<void>;
  onDisposition: (operation: Omit<VocabularyDispositionOperation, "operationId">) => Promise<void> }) {
  const [query, setQuery] = useState(""); const [page, setPage] = useState(1); const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; value: VocabularyCoursesResponse | null; error: string } | null>(null);
  const [assessment, setAssessment] = useState(false); const [editing, setEditing] = useState<VocabularyCourseSummary | null>(null);
  const [viewingTargets, setViewingTargets] = useState<VocabularyCourseSummary | null>(null);
  const [building, setBuilding] = useState(false); const [message, setMessage] = useState("");
  const key = `${query}:${page}:${revision}:${activeCourseId}:${startRank}`;
  const select = (courseId: string | null, rank?: number) => { void onSelect(courseId, rank).catch(() => undefined); };
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ query, page: String(page), pageSize: "12" });
    fetch(`/api/vocabulary/courses?${params}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "课程暂时无法读取。");
      if (!controller.signal.aborted) setResult({ key, value: payload as VocabularyCoursesResponse, error: "" });
    }).catch((error) => { if (!controller.signal.aborted) setResult({ key, value: null, error: error instanceof Error ? error.message : "课程暂时无法读取。" }); });
    return () => controller.abort();
  }, [query, page, revision, activeCourseId, startRank, key]);
  async function extractReading() {
    if (building || busy) return; setBuilding(true); setMessage("");
    try {
      const response = await fetch("/api/vocabulary/courses/reading", { method: "POST" }); const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "阅读课程暂时无法提取。");
      setRevision((value) => value + 1); setMessage(`已扫描 ${payload.files ?? 0} 份阅读资料，整理 ${payload.candidates ?? 0} 条候选原句。原句需在“核对内容”中补齐资料后发布。${payload.warnings?.length ? ` ${payload.warnings.length} 项资料需要检查：${payload.warnings.slice(0, 3).join("；")}` : ""}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "阅读课程暂时无法提取。" ); }
    finally { setBuilding(false); }
  }
  if (assessment) return <VocabularyAssessmentPanel onClose={() => setAssessment(false)} onRecommendation={(courseId, rank) => onSelect(courseId, rank)} />;
  if (editing) return <VocabularyCourseEntries courseId={editing.id} title={editing.title} onClose={() => { setEditing(null); setRevision((value) => value + 1); }} onPublished={() => setRevision((value) => value + 1)} />;
  if (viewingTargets) return <div className={ui.stack}><div className={ui.panelHeader}><h2>{viewingTargets.title}</h2><button type="button" className={ui.buttonGhost} disabled={busy} onClick={() => { setViewingTargets(null); setRevision((value) => value + 1); }}>返回课程列表</button></div><VocabularyTargets courseId={viewingTargets.id} busy={busy} onAction={onDisposition} /></div>;
  const current = result?.key === key ? result : null;
  return <div className={ui.stack} data-vocabulary-courses>
    <section className={ui.panel}><div className={ui.panelHeader}><div><h2>选择新增词的课程</h2><p>每次开启一门课程。已学习的到期词始终优先，不受所选课程和起点影响。</p></div><button type="button" className={ui.buttonSecondary} disabled={busy || building || !activeCourseId} onClick={() => select(null)}>暂停新增词</button></div>
      <input className={ui.input} aria-label="搜索课程" placeholder="搜索课程名称或说明" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} />
      {!current ? <p role="status">正在读取课程…</p> : current.error ? <div role="alert"><p>{current.error}</p><button type="button" className={ui.buttonSecondary} onClick={() => setRevision((value) => value + 1)}>重试读取</button></div>
        : <><div className={styles.courseGrid}>{current.value?.courses.map((course) => <article key={course.id} className={`${styles.courseCard} ${activeCourseId === course.id ? styles.activeCourse : ""}`}><div><span className={styles.small}>{course.kind === "builtin" ? "公开词表 · 原创语境" : "个人课程"} · v{course.version}</span><h3>{course.title}</h3><p>{course.description}</p></div><dl className={styles.courseCounts}><div><dt>可练</dt><dd>{course.ready}</dd></div><div><dt>待核对</dt><dd>{course.pending}</dd></div><div><dt>已学习</dt><dd>{course.learned}</dd></div><div><dt>到期</dt><dd>{course.due}</dd></div></dl>
          {course.id === "general" && <label className={ui.field}><span>新增词起点</span><select className={ui.input} value={activeCourseId === course.id ? startRank : 1} disabled={busy || building} onChange={(event) => select(course.id, Number(event.target.value))}>{[1, 501, 1001, 1501, 2001].map((rank) => <option key={rank} value={rank}>第 {rank} 词起</option>)}</select></label>}
          <div className={styles.courseActions}><button type="button" className={activeCourseId === course.id ? ui.buttonSecondary : ui.button} disabled={busy || building || activeCourseId === course.id || !course.ready} onClick={() => select(course.id, 1)}>{activeCourseId === course.id ? "当前新增课程" : course.ready ? "选择课程" : "待核对后开启"}</button>{course.id.startsWith("ielts-pdf-advanced:") ? <button type="button" className={ui.buttonGhost} disabled={busy || building} onClick={() => setViewingTargets(course)}>查看用法与难度</button> : <button type="button" className={ui.buttonGhost} disabled={busy || building} onClick={() => setEditing(course)}>核对内容</button>}</div>
        </article>)}</div>{!current.value?.courses.length && <p>没有符合条件的课程。</p>}<nav className={styles.pagination} aria-label="课程分页"><button type="button" className={ui.buttonGhost} disabled={page <= 1 || busy} onClick={() => setPage((value) => value - 1)}>上一页</button><span>{page} / {Math.max(1, Math.ceil((current.value?.total ?? 0) / 12))}</span><button type="button" className={ui.buttonGhost} disabled={page * 12 >= (current.value?.total ?? 0) || busy} onClick={() => setPage((value) => value + 1)}>下一页</button></nav></>}
    </section>
    <section className={`${ui.panel} ${styles.courseTools}`}><div><h2>可选词汇摸底</h2><p>30 道语境填空，帮助选择通用词起点或学术课程；也可直接开始学习。</p><button type="button" className={ui.buttonSecondary} disabled={busy || building} onClick={() => setAssessment(true)}>开始 / 继续摸底</button></div><div><h2>从阅读资料提取</h2><p>按原阅读 Passage 整理个人候选词。候选资料待核对，不会自动成为到期词。</p><button type="button" className={ui.buttonSecondary} disabled={busy || building} onClick={() => void extractReading()}>{building ? "正在整理阅读资料…" : "整理阅读词汇课程"}</button></div></section>
    {message && <div className={ui.notice} role="status">{message}</div>}
    <details className={styles.memoryPlan}><summary>课程来源与许可</summary><p>PDF 精选课程来自你提供的本地资料。每个进阶用法保留原始编号、页码、具体释义和收录理由；词条与词性的 B2 / C1 仅作难度参考。此课程不是固定的官方雅思考纲词表。</p><p>通用课程的公开词表来自 Browne、Culligan 与 Phillips 的 <a href="https://www.newgeneralservicelist.com/new-general-service-list" target="_blank" rel="noreferrer">NGSL</a> 和 <a href="https://www.newgeneralservicelist.com/new-academic-word-list" target="_blank" rel="noreferrer">NAWL</a>，使用 <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer">CC BY-SA 4.0</a> 许可。原创学习语境与雅思试题分别标注。</p><p><a href="/api/vocabulary/courses/sources" target="_blank" rel="noreferrer">查看公开词表的下载地址、版本与校验清单</a></p></details>
  </div>;
}
