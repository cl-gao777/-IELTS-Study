"use client";

import Link from "next/link";
import { useState } from "react";
import type { MorphologyCoursesResponse } from "@/lib/morphology";
import ui from "./page-ui.module.css";
import styles from "./morphology.module.css";

export const morphologyKindLabel = { root: "词根", prefix: "前缀", suffix: "后缀" };
export const morphologyElapsed = (seconds: number) => seconds < 60 ? `${Math.floor(seconds)} 秒` : `${Math.floor(seconds / 60)} 分 ${Math.floor(seconds % 60)} 秒`;
export const morphologyTheme = (form: string, title: string) => title.startsWith(form + " · ") ? title.slice(form.length + 3) : title === form ? "" : title;
export const morphologyTitle = (form: string, title: string) => [form, morphologyTheme(form, title)].filter(Boolean).join(" · ");
export function MorphologyCatalogue({ data, onOpen }: { data: MorphologyCoursesResponse; onOpen?: (lessonId: string) => void }) {
  const [query, setQuery] = useState(""); const [kind, setKind] = useState(""); const [progress, setProgress] = useState(""); const [page, setPage] = useState(1);
  const filtered = data.courses.filter(course => (!kind || course.kind === kind)
    && (!query.trim() || [course.form, course.titleZh, course.meaningZh].join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    && (!progress || (progress === "completed" ? Boolean(course.progress?.completedAt) : progress === "read" ? Boolean(course.progress?.readAt && !course.progress.completedAt) : !course.progress?.readAt && !course.progress?.completedAt)));
  const pages = Math.max(1, Math.ceil(filtered.length / 20)); const safePage = Math.min(page, pages);
  return <>
    <dl className={styles.overview}><div><dt>可学课程</dt><dd>{data.courses.length} 课</dd></div><div><dt>已完成练习</dt><dd>{data.courses.filter(c => c.progress?.completedAt).length} 课</dd></div><div><dt>词根累计学习</dt><dd>{morphologyElapsed(data.totalSeconds)}</dd></div></dl>
    <div className={styles.filters}>
      <label className={ui.field}>搜索构词部件或含义<input className={ui.input} type="search" placeholder="例如：词根、前后缀、中文含义" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} /></label>
      <label className={ui.field}>类型<select className={ui.select} value={kind} onChange={e => { setKind(e.target.value); setPage(1); }}><option value="">全部类型</option>{Object.entries(morphologyKindLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className={ui.field}>学习记录<select className={ui.select} value={progress} onChange={e => { setProgress(e.target.value); setPage(1); }}><option value="">全部课程</option><option value="new">尚未完成教学</option><option value="read">已读，未完成练习</option><option value="completed">已完成练习</option></select></label>
    </div>
    <p className={styles.small} role="status">显示 {filtered.length} 课 · 所有课程均可直接学习；不设到期任务，完成记录不代表已掌握。</p>
    <div className={styles.list}>{filtered.slice((safePage - 1) * 20, safePage * 20).map(course => <article key={course.id} className={styles.lessonRow}>
      <div><span className={styles.small}>{morphologyKindLabel[course.kind]} · {String(course.rank).padStart(2, "0")}</span><h2>{course.form} <span className={styles.small}>{morphologyTheme(course.form, course.titleZh)}</span></h2><p>{course.meaningZh !== morphologyTheme(course.form, course.titleZh) && <>{course.meaningZh} · </>}{course.wordCount} 个关联词</p><p>{course.progress?.completedAt ? `已完成 ${course.progress.completedRuns} 轮练习` : course.progress?.readAt ? "已完成教学，可继续练习" : "尚未完成教学"}</p></div>
      <div className={styles.actions}><Link className={ui.buttonSecondary} href={`/morphology/${encodeURIComponent(course.id)}`} onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) onOpen?.(course.id); }}>{course.progress?.completedAt ? "查看 / 重练" : "打开课程"}</Link></div>
    </article>)}</div>
    {!filtered.length && <p className={ui.empty}>没有符合条件的课程，请调整搜索或筛选。</p>}
    {pages > 1 && <nav className={styles.pagination} aria-label="课程分页"><button type="button" className={ui.buttonSecondary} disabled={safePage === 1} onClick={() => setPage(safePage - 1)}>上一页</button><span className={styles.small}>第 {safePage} / {pages} 页</span><button type="button" className={ui.buttonSecondary} disabled={safePage === pages} onClick={() => setPage(safePage + 1)}>下一页</button></nav>}
  </>;
}

export function MorphologyHistoryView({ data, onOpen }: { data: MorphologyCoursesResponse; onOpen?: (lessonId: string) => void }) {
  const statistics = data.statistics;
  return <>
    <dl className={styles.overview}><div><dt>首次独立正确</dt><dd>{statistics.firstIndependentCorrect} / {statistics.firstIndependentTotal}</dd></div><div><dt>有提示正确</dt><dd>{statistics.hintedCorrect} / {statistics.hintedTotal}</dd></div><div><dt>重练独立正确</dt><dd>{statistics.repeatedCorrect} / {statistics.repeatedTotal}</dd></div></dl>
    <p className={styles.small}>首次独立仅计每道题第一次、未取提示的回答，包含尚未完成整轮时已核对的回答；退出或重练不会重置首次样本。各项均不计入原单词准确率或 FSRS。</p>
    <p className={styles.small}>今日词根学习 {morphologyElapsed(data.todaySeconds)} · 以下为最近 {data.history.length} 轮已完成记录。</p>
    {!data.history.length ? <p className={ui.empty}>完成一课练习后，这里会显示你的记录。</p> : <div className={styles.historyScroll}><table className={styles.history}><thead><tr><th>课程与时间</th><th>轮次</th><th>本轮独立</th><th>有提示</th></tr></thead><tbody>{data.history.map(run => <tr key={run.id}><td><Link href={`/morphology/${encodeURIComponent(run.lessonId)}`} onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) onOpen?.(run.lessonId); }}>{run.lessonTitle}</Link><br /><span className={styles.small}>{new Date(run.completedAt).toLocaleString("zh-CN")}</span></td><td>{run.retry === "initial" ? "首次练习" : run.retry === "weak" ? "重练薄弱题" : "重练整课"}</td><td>{run.independentCorrect} / {run.independentTotal}</td><td>{run.hintedCorrect} / {run.hintedTotal}</td></tr>)}</tbody></table></div>}
  </>;
}
