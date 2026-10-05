"use client";

import Link from "next/link";
import { useState } from "react";
import type { PracticeSet, SourceMaterial } from "@/lib/domain";
import { resourceLabel } from "@/lib/official-resources";
import { QUESTION_TYPES } from "@/lib/question-types";
import ui from "./page-ui.module.css";
import styles from "./practice.module.css";

const sampleIds = new Set(["reading-urban-cooling", "listening-campus-project"]);
const filters = [
  { value: "all", label: "全部" },
  { value: "official", label: "官方资源" },
  { value: "sample", label: "原创示例" },
] as const;

export function PracticeLibrary({ kind, sets, materials }: { kind: "reading" | "listening"; sets: PracticeSet[]; materials: SourceMaterial[] }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<(typeof filters)[number]["value"]>("all");
  const reading = kind === "reading";
  const searchText = search.trim().toLocaleLowerCase();
  const officialCount = sets.filter((set) => set.resource).length;
  const officialFullCount = sets.filter((set) => set.resource && set.questions.length === 40).length;
  const questionCount = sets.reduce((total, set) => total + set.questions.length, 0);
  const visibleSets = sets.filter((set) => {
    if (filter === "official" && !set.resource) return false;
    if (filter === "sample" && !sampleIds.has(set.id)) return false;
    return [set.title, set.subtitle, set.instructions, set.resource?.provider, set.resource && resourceLabel(set.resource), ...set.questions.map((question) => QUESTION_TYPES[question.kind].label)]
      .filter(Boolean).join(" ").toLocaleLowerCase().includes(searchText);
  }).sort((a, b) => Number(Boolean(b.resource)) - Number(Boolean(a.resource)));
  const visibleMaterials = materials.filter((material) => material.title.toLocaleLowerCase().includes(searchText));

  return <div className={ui.page}>
    <header className={ui.pageHeader}>
      <div>
        <p className={ui.eyebrow}>Daily Practice · 每日训练</p>
        <h1>{reading ? "Reading · 阅读" : "Listening · 听力"}</h1>
        <p>{reading ? "原版试卷与双栏答题，记录每次练习的答案和错误原因。" : "本地音频、AB 循环、听写差异与原版试卷答题。"} 官方资源、原创示例与自建练习均标明来源。</p>
      </div>
      <Link className={ui.button} href="/materials">＋ 导入{reading ? "文章" : "音频 / Transcript"}</Link>
    </header>

    <section className={styles.libraryControls} aria-label="筛选练习">
      <label className={ui.field}>搜索练习或资料<input className={ui.input} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="标题、来源、题型…" /></label>
      <div className={styles.libraryFilters} aria-label="练习来源">{filters.map((item) => <button type="button" key={item.value} className={filter === item.value ? ui.button : ui.buttonSecondary} aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}</button>)}</div>
      <p className={styles.libraryCount} role="status">共 {sets.length} 组 · {questionCount} 题 · 官方资源：{officialFullCount} 套完整 40 题样题 / {officialCount - officialFullCount} 组专项{searchText || filter !== "all" ? ` · 当前显示 ${visibleSets.length} 组 / ${visibleSets.reduce((total, set) => total + set.questions.length, 0)} 题` : ""}</p>
    </section>

    <div className={styles.libraryGrid}>{visibleSets.map((set) => <article key={set.id} className={`${ui.panel} ${styles.libraryCard}`}>
      <div className={styles.libraryMeta}><span className={set.resource ? ui.statusPill : ui.pill}>{set.resource ? resourceLabel(set.resource) : sampleIds.has(set.id) ? "原创示例" : "自建练习"}</span>{set.resource && <span className={ui.pill}>{set.resource.provider}</span>}</div>
      <p className={ui.eyebrow}>{set.subtitle}</p><h2>{set.title}</h2>
      <div className={styles.libraryMeta}>
        <span className={ui.pill}>{set.questions.length ? `${set.questions.length} 道题` : "自由学习"}</span>
        <span className={ui.pill}>{set.durationMinutes} min</span>
        {set.resource && <span className={ui.pill}>原版 PDF</span>}
        {set.resource && <span className={ui.pill}>{set.questions.length === 40 ? "完整样题" : "专项练习"}</span>}
        {!reading && <span className={ui.pill}>{set.resource ? set.resource.audioTracks.length ? `${set.resource.audioTracks.length} 段本地音频` : "未附音频" : set.audioUrl ? "本地音频" : set.transcript ? "系统 TTS" : "未附音频"}</span>}
      </div>
      <p>{set.instructions}</p>
      <div className={styles.libraryActions}><Link className={ui.buttonGhost} href={`/practice/set/${set.id}`}>打开练习 →</Link>{set.resource && <a href={set.resource.sourceUrl} target="_blank" rel="noreferrer" className={styles.sourceLink}>官方出处 ↗</a>}</div>
    </article>)}</div>
    {!visibleSets.length && <div className={ui.empty}>没有符合筛选条件的练习。可以清空搜索或切换到「全部」。</div>}

    {filter === "all" && materials.length > 0 && <section className={`${ui.panel} ${styles.dictation}`}><h2>我的{reading ? "阅读" : "听力"}资料</h2><p>打开资料开始{reading ? "纯阅读" : "精听听写"}，或添加自定义题目。资料不计入上方练习组数。</p><div className={styles.libraryGrid}>{visibleMaterials.map((material) => <Link className={ui.buttonGhost} key={material.id} href={`/materials/${material.id}`}>{material.title} →</Link>)}</div>{!visibleMaterials.length && <p>没有符合搜索条件的个人资料。</p>}</section>}
  </div>;
}
