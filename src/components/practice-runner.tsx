"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";

import type { PracticeAttempt, PracticeSet } from "@/lib/domain";

import ui from "./page-ui.module.css";
import styles from "./practice.module.css";

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function PracticeRunner({ set }: { set: PracticeSet }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [elapsed, setElapsed] = useState(0);
  const [attempt, setAttempt] = useState<PracticeAttempt | null>(null);
  const [busy, setBusy] = useState(false);
  const [audioState, setAudioState] = useState("Ready");
  const startedAt = useRef(0);

  useEffect(() => {
    if (attempt) return;
    if (startedAt.current === 0) {
      startedAt.current = Date.now();
    }
    const timer = window.setInterval(
      () => setElapsed(Math.round((Date.now() - startedAt.current) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [attempt]);

  useEffect(
    () => () => {
      window.speechSynthesis?.cancel();
    },
    [],
  );

  function playListening() {
    if (!("speechSynthesis" in window)) {
      setAudioState("Speech playback is unavailable in this browser.");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(set.transcript);
    utterance.lang = "en-GB";
    utterance.rate = 0.94;
    utterance.pitch = 1;
    utterance.onstart = () => setAudioState("Playing once…");
    utterance.onend = () => setAudioState("Playback complete");
    utterance.onerror = () => setAudioState("Playback failed");
    window.speechSynthesis.speak(utterance);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const response = await fetch("/api/practice/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        setId: set.id,
        answers,
        durationSeconds: elapsed,
      }),
    });
    const payload = (await response.json()) as {
      attempt?: PracticeAttempt;
      error?: string;
    };
    if (response.ok && payload.attempt) {
      setAttempt(payload.attempt);
      window.speechSynthesis?.cancel();
    }
    setBusy(false);
  }

  return (
    <div className={ui.page}>
      <header className={`${ui.pageHeader} ${styles.examHeader}`}>
        <div>
          <p className={ui.eyebrow}>{set.subtitle}</p>
          <h1>{set.title}</h1>
          <p>{set.instructions}</p>
        </div>
        <div className={styles.timer}>
          <small>{attempt ? "Submitted" : "Elapsed time"}</small>
          <strong>{formatTime(elapsed)}</strong>
        </div>
      </header>

      {attempt && (
        <section className={styles.resultBar}>
          <div>
            <small>Raw score</small>
            <strong>
              {attempt.rawScore}/{attempt.totalQuestions}
            </strong>
          </div>
          <div>
            <small>Estimated band</small>
            <strong>{attempt.bandScore.toFixed(1)}</strong>
          </div>
          <p>
            错题已自动加入 Review。先查看证据，再重做同类问题。
          </p>
          <Link className={ui.button} href="/review">
            Review mistakes
          </Link>
        </section>
      )}

      <form
        className={`${styles.practiceGrid} ${
          set.kind === "listening" ? styles.listeningGrid : ""
        }`}
        onSubmit={submit}
      >
        <section className={`${ui.panel} ${styles.sourcePanel}`}>
          {set.kind === "reading" ? (
            <>
              <div className={styles.paperTitle}>
                <small>Reading passage</small>
                <strong>{set.title}</strong>
              </div>
              <div className={styles.passage}>
                {set.passage.split("\n\n").map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              </div>
            </>
          ) : (
            <div className={styles.listeningPlayer}>
              <div className={styles.soundDisc}>
                <span>▶</span>
              </div>
              <p className={ui.eyebrow}>Listening playback</p>
              <h2>Section 3 · One play</h2>
              <p>
                使用浏览器英式语音播放原创录音稿。正式练习时先读题，再播放一次。
              </p>
              <button
                className={ui.buttonSecondary}
                type="button"
                onClick={playListening}
                disabled={Boolean(attempt)}
              >
                Play recording
              </button>
              <small>{audioState}</small>
              {attempt && (
                <details className={styles.transcript}>
                  <summary>Show transcript after submission</summary>
                  {set.transcript.split("\n\n").map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
                </details>
              )}
            </div>
          )}
        </section>

        <section className={`${ui.panel} ${styles.questionPanel}`}>
          <div className={ui.panelHeader}>
            <div>
              <p className={ui.eyebrow}>Questions</p>
              <h2>Answer all {set.questions.length}</h2>
            </div>
            <span className={ui.pill}>
              {Object.values(answers).filter(Boolean).length}/
              {set.questions.length}
            </span>
          </div>
          <div className={styles.questions}>
            {set.questions.map((question, index) => {
              const detail = attempt?.answers.find(
                (answer) => answer.questionId === question.id,
              );
              return (
                <fieldset
                  className={`${styles.question} ${
                    detail
                      ? detail.correct
                        ? styles.correct
                        : styles.incorrect
                      : ""
                  }`}
                  key={question.id}
                >
                  <legend>
                    <span>{index + 1}</span>
                    {question.prompt}
                  </legend>
                  {question.options ? (
                    <div className={styles.options}>
                      {question.options.map((option) => (
                        <label key={option}>
                          <input
                            type="radio"
                            name={question.id}
                            value={option}
                            checked={answers[question.id] === option}
                            disabled={Boolean(attempt)}
                            onChange={(event) =>
                              setAnswers((current) => ({
                                ...current,
                                [question.id]: event.target.value,
                              }))
                            }
                          />
                          <span>{option}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <input
                      className={ui.input}
                      value={answers[question.id] ?? ""}
                      disabled={Boolean(attempt)}
                      onChange={(event) =>
                        setAnswers((current) => ({
                          ...current,
                          [question.id]: event.target.value,
                        }))
                      }
                      placeholder="Type your answer"
                    />
                  )}
                  {detail && (
                    <div className={styles.evidence}>
                      <strong>
                        {detail.correct ? "Correct" : "Expected answer"}
                      </strong>
                      {!detail.correct && <span>{detail.expected.join(" / ")}</span>}
                      <p>{question.explanation}</p>
                    </div>
                  )}
                </fieldset>
              );
            })}
          </div>
          {!attempt && (
            <button className={ui.button} type="submit" disabled={busy}>
              {busy ? "Scoring…" : "Submit answers"}
            </button>
          )}
        </section>
      </form>
    </div>
  );
}
