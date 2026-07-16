"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { DashboardSnapshot, StudyTask } from "@/lib/domain";
import { calculateStudyProgress } from "@/lib/study-progress";

import ui from "./page-ui.module.css";
import styles from "./dashboard.module.css";

export function Dashboard({ initial }: { initial: DashboardSnapshot }) {
  const [tasks, setTasks] = useState(initial.tasks);
  const [busyTask, setBusyTask] = useState("");
  const progress = useMemo(() => calculateStudyProgress(tasks), [tasks]);
  const nextTask = tasks.find((task) => !task.completed);

  async function toggleTask(task: StudyTask) {
    setBusyTask(task.id);
    const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
      method: "POST",
    });
    if (response.ok) {
      const payload = (await response.json()) as { task: StudyTask };
      setTasks((current) =>
        current.map((item) => (item.id === task.id ? payload.task : item)),
      );
    }
    setBusyTask("");
  }

  const skills = [
    { name: "Listening", band: initial.estimatedBands.listening },
    { name: "Reading", band: initial.estimatedBands.reading },
    { name: "Writing", band: initial.estimatedBands.writing },
  ];

  return (
    <div className={ui.page}>
      <header className={ui.pageHeader}>
        <div>
          <p className={ui.eyebrow}>{initial.displayDate}</p>
          <h1>Good evening, Aimer.</h1>
          <p>
            今天只需要完成闭环：练习、提交、看证据、把错误送进复习队列。
          </p>
        </div>
        <div className={ui.headerActions}>
          <span className={ui.statusPill}>Local workspace</span>
          <span className={ui.pill}>{initial.streak} day streak</span>
        </div>
      </header>

      <section className={styles.heroGrid}>
        <article className={`${ui.panel} ${ui.panelDark} ${styles.mission}`}>
          <div>
            <p className={ui.eyebrow}>Today&apos;s mission</p>
            <h2>{progress.totalMinutes} focused minutes</h2>
            <p>
              {nextTask
                ? `下一项：${nextTask.title}`
                : "今日任务全部完成。去复盘错误，或让小C安排明天的学习。"}
            </p>
            <div className={styles.actionRow}>
              <Link
                className={ui.buttonSecondary}
                href={nextTask?.href ?? "/review"}
              >
                ▶ {nextTask ? "Start next focus" : "Open review"}
              </Link>
              <Link className={styles.darkLink} href="/coach">
                Ask 女仆小C →
              </Link>
            </div>
          </div>
          <div
            className={styles.orbit}
            style={
              {
                "--progress": `${progress.percentage * 3.6}deg`,
              } as React.CSSProperties
            }
          >
            <div>
              <strong>{progress.percentage}%</strong>
              <span>
                {progress.completedMinutes}/{progress.totalMinutes} min
              </span>
            </div>
          </div>
        </article>

        <article className={ui.panel}>
          <div className={ui.panelHeader}>
            <div>
              <p className={ui.eyebrow}>Current signal</p>
              <h2>
                {initial.estimatedBands.overall
                  ? `Estimated ${initial.estimatedBands.overall.toFixed(1)}`
                  : "Build a baseline"}
              </h2>
            </div>
            <Link className={ui.buttonGhost} href="/analytics">
              Details
            </Link>
          </div>
          <div className={styles.skillList}>
            {skills.map((skill) => (
              <div className={styles.skill} key={skill.name}>
                <div>
                  <span>{skill.name}</span>
                  <strong>{skill.band ? skill.band.toFixed(1) : "—"}</strong>
                </div>
                <div>
                  <i
                    style={{
                      width: `${skill.band ? (skill.band / 9) * 100 : 4}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className={styles.caption}>
            这里只显示你的练习估算，不冒充官方 IELTS 成绩。
          </p>
        </article>
      </section>

      <section className={styles.contentGrid}>
        <article className={ui.panel}>
          <div className={ui.panelHeader}>
            <div>
              <p className={ui.eyebrow}>Daily study loop</p>
              <h2>Four deliberate steps</h2>
            </div>
            <span className={ui.pill}>
              {tasks.filter((task) => task.completed).length}/{tasks.length}
            </span>
          </div>
          <div className={styles.taskList}>
            {tasks.map((task, index) => (
              <div
                className={`${styles.task} ${task.completed ? styles.done : ""}`}
                key={task.id}
              >
                <button
                  type="button"
                  onClick={() => toggleTask(task)}
                  disabled={busyTask === task.id}
                  aria-label={`Toggle ${task.title}`}
                >
                  {task.completed ? "✓" : String(index + 1).padStart(2, "0")}
                </button>
                <Link href={task.href}>
                  <small>{task.area}</small>
                  <strong>{task.title}</strong>
                  <span>{task.detail}</span>
                </Link>
                <span>
                  <b>{task.estimatedMinutes}</b>
                  min
                </span>
              </div>
            ))}
          </div>
        </article>

        <div className={ui.stack}>
          <article className={ui.panel}>
            <div className={ui.panelHeader}>
              <div>
                <p className={ui.eyebrow}>Queue</p>
                <h2>What needs attention</h2>
              </div>
            </div>
            <div className={styles.queue}>
              <Link href="/vocabulary">
                <span>Aa</span>
                <div>
                  <strong>{initial.dueVocabulary} words due</strong>
                  <small>Recall before recognition</small>
                </div>
              </Link>
              <Link href="/review">
                <span>↺</span>
                <div>
                  <strong>{initial.reviewCount} mistakes to review</strong>
                  <small>Evidence from submitted attempts</small>
                </div>
              </Link>
              <Link href="/mock-exam">
                <span>◫</span>
                <div>
                  <strong>Full computer mock</strong>
                  <small>Listening · Reading · Writing</small>
                </div>
              </Link>
            </div>
          </article>

          <article className={`${ui.panel} ${styles.coachCard}`}>
            <div className={styles.coachTitle}>
              <span>C</span>
              <div>
                <p className={ui.eyebrow}>AI English coach</p>
                <h2>女仆小C</h2>
              </div>
            </div>
            <p>
              中文、英文、混合输入都可以。小C会先把你的意思改成自然英文，再继续回答。
            </p>
            <Link className={ui.button} href="/coach">
              Open conversation
            </Link>
          </article>
        </div>
      </section>
    </div>
  );
}

