import Link from "next/link";

import ui from "@/components/page-ui.module.css";
import { listPracticeSets } from "@/server/store";

export const dynamic = "force-dynamic";

export default function PracticePage() {
  const sets = listPracticeSets();

  return (
    <div className={ui.page}>
      <header className={ui.pageHeader}>
        <div>
          <p className={ui.eyebrow}>Deliberate practice</p>
          <h1>Practice room</h1>
          <p>
            所有内置内容均为本项目原创示例。完成后自动评分、保存 attempt，并把错题送入复盘。
          </p>
        </div>
      </header>
      <div className={ui.grid2}>
        {sets.map((set) => (
          <article className={ui.panel} key={set.id}>
            <div className={ui.panelHeader}>
              <div>
                <p className={ui.eyebrow}>{set.subtitle}</p>
                <h2>{set.title}</h2>
              </div>
              <span className={ui.pill}>{set.durationMinutes} min</span>
            </div>
            <p>{set.instructions}</p>
            <div className={ui.grid3}>
              <div className={ui.metric}>
                <small>Questions</small>
                <strong>{set.questions.length}</strong>
                <span>Auto-scored</span>
              </div>
              <div className={ui.metric}>
                <small>Mode</small>
                <strong>{set.kind === "reading" ? "R" : "L"}</strong>
                <span>{set.kind}</span>
              </div>
              <div className={ui.metric}>
                <small>Result</small>
                <strong>0–9</strong>
                <span>Estimated band</span>
              </div>
            </div>
            <br />
            <Link className={ui.button} href={`/practice/set/${set.id}`}>
              Open {set.kind} drill
            </Link>
          </article>
        ))}
      </div>
    </div>
  );
}
