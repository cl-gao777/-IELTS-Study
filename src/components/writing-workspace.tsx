"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import type { WritingSubmission } from "@/lib/domain";

import ui from "./page-ui.module.css";
import styles from "./writing.module.css";

const prompts = {
  "task-1":
    "The chart below shows the proportion of household spending allocated to housing, transport and food in three cities. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.",
  "task-2":
    "Some people believe cities should spend more money on public transport than on building new roads. To what extent do you agree or disagree?",
};

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function WritingWorkspace({
  initialSubmissions,
}: {
  initialSubmissions: WritingSubmission[];
}) {
  const [taskType, setTaskType] =
    useState<WritingSubmission["taskType"]>("task-2");
  const [prompt, setPrompt] = useState(prompts["task-2"]);
  const [essay, setEssay] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<WritingSubmission | null>(
    initialSubmissions[0] ?? null,
  );
  const [provider, setProvider] = useState("");
  const [error, setError] = useState("");
  const startedAt = useRef(0);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(
      () =>
        setElapsed(
          Math.round((Date.now() - startedAt.current) / 1000),
        ),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [running]);

  const wordCount = useMemo(
    () => essay.trim().split(/\s+/).filter(Boolean).length,
    [essay],
  );
  const targetWords = taskType === "task-1" ? 150 : 250;

  function changeTask(next: WritingSubmission["taskType"]) {
    setTaskType(next);
    setPrompt(prompts[next]);
    setFeedback(null);
  }

  function startTimer() {
    startedAt.current = Date.now() - elapsed * 1000;
    setRunning(true);
  }

  async function evaluate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setRunning(false);
    const response = await fetch("/api/writing/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskType, prompt, essay }),
    });
    const payload = (await response.json()) as {
      submission?: WritingSubmission;
      provider?: string;
      error?: string;
    };
    if (response.ok && payload.submission) {
      setFeedback(payload.submission);
      setProvider(payload.provider ?? "");
    } else {
      setError(payload.error ?? "Feedback request failed.");
    }
    setBusy(false);
  }

  return (
    <div className={ui.page}>
      <header className={ui.pageHeader}>
        <div>
          <p className={ui.eyebrow}>Academic writing studio</p>
          <h1>Draft → evidence → rewrite</h1>
          <p>
            先独立完成，再请求估分和四项标准反馈。AI 结果用于训练，不冒充官方评分。
          </p>
        </div>
        <div className={ui.headerActions}>
          <span className={ui.pill}>
            {wordCount}/{targetWords}+ words
          </span>
          <span className={styles.clock}>{formatTime(elapsed)}</span>
        </div>
      </header>

      <form className={styles.writingGrid} onSubmit={evaluate}>
        <section className={`${ui.panel} ${styles.editorPanel}`}>
          <div className={styles.taskTabs}>
            {(["task-1", "task-2"] as const).map((type) => (
              <button
                type="button"
                key={type}
                className={taskType === type ? styles.activeTab : ""}
                onClick={() => changeTask(type)}
              >
                {type === "task-1" ? "Task 1" : "Task 2"}
              </button>
            ))}
            <button
              type="button"
              className={styles.timerButton}
              onClick={() => (running ? setRunning(false) : startTimer())}
            >
              {running ? "Pause timer" : elapsed ? "Resume timer" : "Start timer"}
            </button>
          </div>

          <div className={ui.field}>
            <label htmlFor="writing-prompt">Prompt</label>
            <textarea
              className={`${ui.textarea} ${styles.promptInput}`}
              id="writing-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </div>

          <div className={styles.document}>
            <textarea
              value={essay}
              onChange={(event) => setEssay(event.target.value)}
              placeholder="Write your response here. Use a blank line between paragraphs…"
              spellCheck
            />
            <footer>
              <span>
                {wordCount < targetWords
                  ? `${targetWords - wordCount} words to minimum`
                  : "Minimum reached"}
              </span>
              <span>Autosaved in this browser session</span>
            </footer>
          </div>

          {error && <div className={ui.error}>{error}</div>}
          <div className={styles.submitRow}>
            <small>
              提交后会把完整作文、估分和反馈写入学习数据库。
            </small>
            <button
              className={ui.button}
              type="submit"
              disabled={busy || essay.trim().length < 40}
            >
              {busy ? "Evaluating…" : "Submit for feedback"}
            </button>
          </div>
        </section>

        <aside className={ui.stack}>
          <section className={`${ui.panel} ${styles.feedbackPanel}`}>
            <div className={ui.panelHeader}>
              <div>
                <p className={ui.eyebrow}>Latest feedback</p>
                <h2>
                  {feedback
                    ? `Estimated ${feedback.overallBand.toFixed(1)}`
                    : "Awaiting draft"}
                </h2>
              </div>
              {provider && <span className={ui.pill}>{provider}</span>}
            </div>
            {feedback ? (
              <>
                <div className={styles.criteria}>
                  {Object.entries({
                    "Task response": feedback.criteria.taskResponse,
                    "Coherence & cohesion":
                      feedback.criteria.coherenceCohesion,
                    "Lexical resource": feedback.criteria.lexicalResource,
                    "Grammar accuracy": feedback.criteria.grammarAccuracy,
                  }).map(([label, score]) => (
                    <div key={label}>
                      <span>{label}</span>
                      <strong>{score.toFixed(1)}</strong>
                      <i>
                        <b style={{ width: `${(score / 9) * 100}%` }} />
                      </i>
                    </div>
                  ))}
                </div>
                <div className={styles.feedbackList}>
                  <h3>Strengths</h3>
                  <ul>
                    {feedback.strengths.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  <h3>Next revision</h3>
                  <ul>
                    {feedback.improvements.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <details className={styles.rewrite}>
                  <summary>Show model rewrite</summary>
                  <p>{feedback.rewrite}</p>
                </details>
              </>
            ) : (
              <div className={ui.empty}>
                完成草稿后，四项标准和可执行修改建议会显示在这里。
              </div>
            )}
          </section>
          <section className={`${ui.panel} ${ui.panelDark}`}>
            <p className={ui.eyebrow}>Revision rule</p>
            <h2>一次只改一个层级</h2>
            <p>
              第一遍看论证和段落，第二遍看词汇精度，最后才修语法。不要同时重写所有东西。
            </p>
          </section>
        </aside>
      </form>
    </div>
  );
}

