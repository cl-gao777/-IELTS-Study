"use client";

import { useEffect, useState } from "react";
import type { VocabularyDispositionOperation, VocabularyTargetCounts, VocabularyTargetSnapshot, VocabularyTargetState, VocabularyTermDisposition } from "@/lib/vocabulary-target";
import { VocabularyTargetDetails } from "./vocabulary-target-details";
import ui from "./page-ui.module.css";
import styles from "./vocabulary.module.css";

type TargetsPage = { targets: VocabularyTargetSnapshot[]; targetStates: VocabularyTargetState[]; termDispositions: VocabularyTermDisposition[];
  targetCounts: VocabularyTargetCounts; restoreVersion: number };
export function VocabularyTargets({ busy, courseId, onAction }: { busy: boolean; courseId?: string;
  onAction: (operation: Omit<VocabularyDispositionOperation, "operationId">) => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"active" | "known" | "paused-term" | "all">("active");
  const [page, setPage] = useState(1); const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; value: TargetsPage | null; error: string } | null>(null);
  const [mutating, setMutating] = useState(false);
  const key = `${courseId ?? "all"}:${revision}`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/vocabulary/targets${courseId ? `?courseId=${encodeURIComponent(courseId)}` : ""}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "用法资料暂时无法读取。");
        if (!controller.signal.aborted) setResult({ key, value: payload as TargetsPage, error: "" });
      }).catch((error) => { if (!controller.signal.aborted) setResult({ key, value: null, error: error instanceof Error ? error.message : "用法资料暂时无法读取。" }); });
    return () => controller.abort();
  }, [courseId, key, revision]);
  const current = result?.key === key ? result : null;
  const data = current?.value;
  const states = new Map(data?.targetStates.map((state) => [state.targetId, state]));
  const terms = new Map(data?.termDispositions.map((state) => [state.normalizedTerm, state]));
  const search = query.trim().toLocaleLowerCase("en");
  const targets = (data?.targets ?? []).filter((target) => {
    const state = states.get(target.id); const term = terms.get(target.normalizedTerm);
    return (!courseId || target.courseId === courseId)
      && (!search || [target.term, target.partOfSpeech, target.meaningZh, target.definitionEn].join(" ").toLocaleLowerCase("en").includes(search))
      && (filter === "all" || filter === "known" && state?.paused || filter === "paused-term" && term?.paused || filter === "active" && !state?.paused && !term?.paused);
  });
  async function act(target: VocabularyTargetSnapshot, action: VocabularyDispositionOperation["action"]) {
    if (!data || busy || mutating) return;
    setMutating(true);
    try {
      await onAction({ action, restoreVersion: data.restoreVersion,
        ...(action.endsWith("target") ? { targetId: target.id, targetVersion: target.version, expectedStateVersion: states.get(target.id)?.version ?? 0 }
          : { term: target.normalizedTerm, expectedStateVersion: terms.get(target.normalizedTerm)?.version ?? 0 }) });
      setRevision((value) => value + 1);
    } finally { setMutating(false); }
  }
  return <section className={ui.panel} aria-label="进阶用法与学习选择" data-vocabulary-targets>
    <div className={ui.panelHeader}><div><h2>用法与学习选择</h2><p>“这个用法已会”只跳过同一义项；“整词暂不学习”在所有课程生效。均保留历史，不生成评分。</p></div></div>
    {data && <dl className={styles.progressStrip}><div><dt>自报用法已会</dt><dd>{data.targetCounts.pausedTargets} 个</dd></div><div><dt>整词暂停</dt><dd>{data.targetCounts.pausedTerms} 个</dd></div><div><dt>已介绍用法</dt><dd>{data.targetCounts.introducedTargets} 个</dd></div></dl>}
    <div className={styles.searchRow}><input className={ui.input} aria-label="搜索进阶用法" value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="搜索单词、词性或释义" disabled={busy || mutating} /><select className={ui.input} aria-label="学习选择筛选" value={filter} onChange={(event) => { setFilter(event.target.value as typeof filter); setPage(1); }} disabled={busy || mutating}><option value="active">正在学习</option><option value="known">自报用法已会</option><option value="paused-term">整词已暂停</option><option value="all">全部用法</option></select></div>
    {!current ? <p role="status">正在读取用法资料…</p> : current.error ? <div role="alert"><p>{current.error}</p><button className={ui.buttonSecondary} type="button" onClick={() => setRevision((value) => value + 1)}>重试读取</button></div>
      : <><div className={styles.targetList}>{targets.slice((page - 1) * 12, page * 12).map((target) => {
        const state = states.get(target.id); const term = terms.get(target.normalizedTerm);
        return <article key={target.id} className={styles.targetItem}><div className={styles.targetHeading}><h3>{target.term} <span>{target.partOfSpeech}</span></h3><span className={styles.small}>{target.level ? `${target.level} · 难度参考` : "按资料核对"} · {term?.paused ? "整词已暂停" : state?.paused ? "自报用法已会" : state?.introducedAt ? "已介绍用法" : "尚未介绍"}</span></div><strong>{target.meaningZh}</strong><p>{target.definitionEn}</p><VocabularyTargetDetails target={target} /><div className={styles.courseActions}><button type="button" className={ui.buttonSecondary} disabled={busy || mutating} onClick={() => void act(target, state?.paused ? "resume-target" : "know-target")}>{state?.paused ? "恢复这个用法" : "这个用法已会"}</button><button type="button" className={ui.buttonGhost} disabled={busy || mutating} onClick={() => void act(target, term?.paused ? "resume-term" : "pause-term")}>{term?.paused ? "恢复整词学习" : "整词暂不学习"}</button></div></article>;
      })}</div>{!targets.length && <p>没有符合条件的用法。</p>}<nav className={styles.pagination} aria-label="用法分页"><button type="button" className={ui.buttonGhost} disabled={busy || mutating || page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button><span>{page} / {Math.max(1, Math.ceil(targets.length / 12))} · {targets.length} 个用法</span><button type="button" className={ui.buttonGhost} disabled={busy || mutating || page * 12 >= targets.length} onClick={() => setPage((value) => value + 1)}>下一页</button></nav></>}
    <p className={styles.small}>这些选择是自报学习偏好，不是实测掌握率。恢复不会重算已有 FSRS 或补写历史答题。</p>
  </section>;
}
