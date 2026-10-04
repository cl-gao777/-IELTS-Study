import Link from "next/link";
import type { PracticeSet, SourceMaterial } from "@/lib/domain";
import ui from "./page-ui.module.css";
import styles from "./practice.module.css";
export function PracticeLibrary({ kind, sets, materials }: { kind: "reading" | "listening"; sets: PracticeSet[]; materials: SourceMaterial[] }) {
  const reading = kind === "reading";
  return <div className={ui.page}><header className={ui.pageHeader}><div><p className={ui.eyebrow}>Daily Practice · 每日训练</p><h1>{reading ? "Reading · 阅读" : "Listening · 听力"}</h1><p>{reading ? "双栏阅读、原文证据与错误原因，让每次练习有据可查。" : "本地音频、AB 循环、听写差异与题型训练。"} 所有内置练习均为原创示例。</p></div><Link className={ui.button} href="/materials">＋ 导入{reading ? "文章" : "音频 / Transcript"}</Link></header>
    <div className={styles.libraryGrid}>{sets.map((set) => <article key={set.id} className={`${ui.panel} ${styles.libraryCard}`}><p className={ui.eyebrow}>{set.subtitle}</p><h2>{set.title}</h2><div className={styles.libraryMeta}><span className={ui.pill}>{set.questions.length ? `${set.questions.length} 道题` : "自由学习"}</span><span className={ui.pill}>{set.durationMinutes} min</span>{!reading && <span className={ui.pill}>{set.audioUrl ? "本地音频" : "系统 TTS"}</span>}</div><p>{set.instructions}</p><Link className={ui.buttonGhost} href={`/practice/set/${set.id}`}>打开练习 →</Link></article>)}</div>
    {materials.length > 0 && <section className={`${ui.panel} ${styles.dictation}`}><h2>我的{reading ? "阅读" : "听力"}资料</h2><p>打开资料开始{reading ? "纯阅读" : "精听听写"}，或添加自定义题目。</p><div className={styles.libraryGrid}>{materials.map((material) => <Link className={ui.buttonGhost} key={material.id} href={`/materials/${material.id}`}>{material.title} →</Link>)}</div></section>}
  </div>;
}
