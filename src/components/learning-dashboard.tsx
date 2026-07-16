"use client";

import { FormEvent, useMemo, useState } from "react";

import { calculateStudyProgress } from "@/lib/study-progress";

import styles from "./learning-dashboard.module.css";

type StudyArea = "Vocabulary" | "Listening" | "Reading" | "Writing";

interface StudyTask {
  id: string;
  area: StudyArea;
  title: string;
  detail: string;
  estimatedMinutes: number;
  completed: boolean;
}

const initialTasks: StudyTask[] = [
  {
    id: "vocabulary-review",
    area: "Vocabulary",
    title: "Review 18 due words",
    detail: "Active recall · Academic Word List",
    estimatedMinutes: 20,
    completed: true,
  },
  {
    id: "listening-section",
    area: "Listening",
    title: "Complete one Section 3 drill",
    detail: "Predict answers before the audio starts",
    estimatedMinutes: 20,
    completed: false,
  },
  {
    id: "reading-passage",
    area: "Reading",
    title: "Finish one timed passage",
    detail: "Matching headings · 18 minute limit",
    estimatedMinutes: 25,
    completed: false,
  },
  {
    id: "writing-revision",
    area: "Writing",
    title: "Rewrite yesterday’s introduction",
    detail: "Improve thesis clarity and lexical precision",
    estimatedMinutes: 30,
    completed: false,
  },
];

const skillReadiness = [
  { label: "Listening", score: 5.5, width: "61%" },
  { label: "Reading", score: 6, width: "67%" },
  { label: "Writing", score: 5.5, width: "61%" },
];

const navItems = [
  { label: "Today", icon: "⌂", current: true },
  { label: "Vocabulary", icon: "Aa" },
  { label: "Practice", icon: "✓" },
  { label: "Mock exam", icon: "◫" },
  { label: "Review", icon: "↺" },
];

function buildCoachReply(prompt: string) {
  const containsChinese = /[\u3400-\u9fff]/.test(prompt);

  if (containsChinese) {
    return {
      label: "Natural English",
      text: `How can I express “${prompt}” naturally in English?`,
      note: "你可以先直接输入中文。小C会先给出自然英文，再回答你的真实问题。",
    };
  }

  return {
    label: "小C的建议",
    text: `Your sentence is understandable. A smoother opening is: “I’d like to ask about ${prompt.replace(/[?.!]+$/, "")}.”`,
    note: "This is a local interaction preview. The model connection comes in the next milestone.",
  };
}

export function LearningDashboard() {
  const [tasks, setTasks] = useState(initialTasks);
  const [coachInput, setCoachInput] = useState("");
  const [coachReply, setCoachReply] = useState({
    label: "女仆小C",
    text: "Good evening. Try asking me in English — but Chinese is always welcome when you get stuck.",
    note: "输入中文时，我会顺便教你怎样用自然英语表达。",
  });
  const [focusMessage, setFocusMessage] = useState(
    "Your next task is ready when you are.",
  );

  const progress = useMemo(
    () =>
      calculateStudyProgress(
        tasks.map((task) => ({
          estimatedMinutes: task.estimatedMinutes,
          completed: task.completed,
        })),
      ),
    [tasks],
  );

  const nextTask = tasks.find((task) => !task.completed);

  function toggleTask(taskId: string) {
    setTasks((current) =>
      current.map((task) =>
        task.id === taskId ? { ...task, completed: !task.completed } : task,
      ),
    );
  }

  function startFocusSession() {
    if (!nextTask) {
      setFocusMessage("All tasks complete. Time for a short review and rest.");
      return;
    }

    setFocusMessage(
      `${nextTask.area} focus started · ${nextTask.estimatedMinutes} minutes`,
    );
  }

  function submitCoachPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = coachInput.trim();

    if (!prompt) {
      return;
    }

    setCoachReply(buildCoachReply(prompt));
    setCoachInput("");
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <a className={styles.brand} href="#main-content" aria-label="ISTS 首页">
          <span className={styles.brandMark}>I</span>
          <span>
            <strong>ISTS</strong>
            <small>IELTS Study OS</small>
          </span>
        </a>

        <nav className={styles.nav} aria-label="主要导航">
          <p className={styles.navLabel}>Workspace</p>
          {navItems.map((item) => (
            <button
              className={`${styles.navItem} ${item.current ? styles.navItemCurrent : ""}`}
              key={item.label}
              type="button"
              aria-current={item.current ? "page" : undefined}
              title={item.current ? item.label : `${item.label} — coming soon`}
            >
              <span className={styles.navIcon}>{item.icon}</span>
              <span>{item.label}</span>
              {!item.current && <small>Soon</small>}
            </button>
          ))}
        </nav>

        <div className={styles.sidebarFooter}>
          <div className={styles.streakBadge}>
            <span>7</span>
            <div>
              <strong>day streak</strong>
              <small>Keep the chain alive</small>
            </div>
          </div>
          <button className={styles.profile} type="button">
            <span>A</span>
            <div>
              <strong>Aimer</strong>
              <small>Target band 7.0</small>
            </div>
            <b>•••</b>
          </button>
        </div>
      </aside>

      <main className={styles.main} id="main-content">
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Thursday · 16 July</p>
            <h1>Good evening, Aimer.</h1>
            <p>Small, deliberate practice. Every day.</p>
          </div>
          <div className={styles.headerActions}>
            <span className={styles.syncStatus}>
              <i />
              Local workspace
            </span>
            <button className={styles.iconButton} type="button" aria-label="通知">
              2
            </button>
          </div>
        </header>

        <section className={styles.heroGrid} aria-label="今日学习概览">
          <article className={styles.focusCard}>
            <div className={styles.focusCopy}>
              <span className={styles.cardKicker}>Today’s mission</span>
              <h2>{progress.totalMinutes} focused minutes</h2>
              <p>
                Finish the loop, then ask 小C to turn today’s mistakes into
                tomorrow’s review.
              </p>
              <button
                className={styles.primaryButton}
                type="button"
                onClick={startFocusSession}
              >
                <span>▶</span>
                Start next focus
              </button>
              <small className={styles.focusMessage} aria-live="polite">
                {focusMessage}
              </small>
            </div>

            <div
              className={styles.progressOrbit}
              style={
                {
                  "--progress": `${progress.percentage * 3.6}deg`,
                } as React.CSSProperties
              }
              aria-label={`${progress.percentage}% complete`}
            >
              <div>
                <strong>{progress.percentage}%</strong>
                <span>
                  {progress.completedMinutes}/{progress.totalMinutes} min
                </span>
              </div>
            </div>
          </article>

          <article className={styles.readinessCard}>
            <div className={styles.cardHeader}>
              <div>
                <span className={styles.cardKicker}>Exam readiness</span>
                <h2>Estimated 5.5</h2>
              </div>
              <span className={styles.trend}>↗ 0.5</span>
            </div>
            <div className={styles.skillList}>
              {skillReadiness.map((skill) => (
                <div className={styles.skillRow} key={skill.label}>
                  <div>
                    <span>{skill.label}</span>
                    <strong>{skill.score.toFixed(1)}</strong>
                  </div>
                  <div className={styles.skillTrack}>
                    <span style={{ width: skill.width }} />
                  </div>
                </div>
              ))}
            </div>
            <button className={styles.textButton} type="button">
              View diagnostic report →
            </button>
          </article>
        </section>

        <div className={styles.contentGrid}>
          <section className={styles.column}>
            <article className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <span className={styles.cardKicker}>Daily study loop</span>
                  <h2>Four deliberate steps</h2>
                </div>
                <span className={styles.taskCount}>
                  {tasks.filter((task) => task.completed).length}/{tasks.length}
                </span>
              </div>

              <div className={styles.taskList}>
                {tasks.map((task, index) => (
                  <button
                    className={`${styles.task} ${task.completed ? styles.taskDone : ""}`}
                    key={task.id}
                    type="button"
                    onClick={() => toggleTask(task.id)}
                    aria-pressed={task.completed}
                  >
                    <span className={styles.taskNumber}>
                      {task.completed ? "✓" : String(index + 1).padStart(2, "0")}
                    </span>
                    <span className={styles.taskCopy}>
                      <small>{task.area}</small>
                      <strong>{task.title}</strong>
                      <span>{task.detail}</span>
                    </span>
                    <span className={styles.taskTime}>
                      {task.estimatedMinutes}
                      <small>min</small>
                    </span>
                  </button>
                ))}
              </div>
            </article>

            <article className={`${styles.panel} ${styles.examPanel}`}>
              <div>
                <span className={styles.cardKicker}>Next mock exam</span>
                <h2>Academic mini mock #01</h2>
                <p>Listening Section 3 · Reading Passage 1 · Writing Task 2</p>
              </div>
              <div className={styles.examMeta}>
                <span>
                  <strong>75</strong> min
                </span>
                <span>
                  <strong>Sun</strong> planned
                </span>
                <button type="button">Open exam room</button>
              </div>
            </article>
          </section>

          <section className={styles.column}>
            <article className={`${styles.panel} ${styles.coachPanel}`}>
              <div className={styles.coachHeader}>
                <div className={styles.coachAvatar}>C</div>
                <div>
                  <span className={styles.cardKicker}>AI English coach</span>
                  <h2>女仆小C</h2>
                </div>
                <span className={styles.onlineStatus}>online</span>
              </div>

              <div className={styles.coachMessage} aria-live="polite">
                <span>{coachReply.label}</span>
                <p>{coachReply.text}</p>
                <small>{coachReply.note}</small>
              </div>

              <form className={styles.coachForm} onSubmit={submitCoachPrompt}>
                <label htmlFor="coach-prompt">
                  Ask in English — 中文也可以
                </label>
                <div>
                  <textarea
                    id="coach-prompt"
                    value={coachInput}
                    onChange={(event) => setCoachInput(event.target.value)}
                    placeholder="例如：我应该怎么描述今天学习效率不高？"
                    rows={3}
                  />
                  <button type="submit" aria-label="发送给女仆小C">
                    ↑
                  </button>
                </div>
              </form>
            </article>

            <article className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <span className={styles.cardKicker}>Vocabulary pulse</span>
                  <h2>18 words due</h2>
                </div>
                <button className={styles.textButton} type="button">
                  Review all →
                </button>
              </div>
              <div className={styles.wordCard}>
                <div>
                  <small>/ˌæm.bɪˈɡjuː.ə.ti/</small>
                  <strong>ambiguity</strong>
                  <span>n. 模棱两可；歧义</span>
                </div>
                <p>
                  The policy’s <b>ambiguity</b> caused widespread confusion.
                </p>
                <div className={styles.wordActions}>
                  <button type="button">Again</button>
                  <button type="button">Hard</button>
                  <button type="button">Good</button>
                </div>
              </div>
            </article>
          </section>
        </div>
      </main>
    </div>
  );
}
