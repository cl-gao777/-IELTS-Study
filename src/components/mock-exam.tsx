"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import type {
  PracticeAttempt,
  PracticeSet,
  WritingSubmission,
} from "@/lib/domain";

import ui from "./page-ui.module.css";
import styles from "./mock-exam.module.css";

type Stage = "briefing" | "listening" | "reading" | "writing" | "result";

interface MockResult {
  mock: { id: number; overallBand: number };
  listening: PracticeAttempt;
  reading: PracticeAttempt;
  writing: WritingSubmission;
  provider: string;
}

const writingPrompt =
  "Some people believe cities should spend more money on public transport than on building new roads. To what extent do you agree or disagree?";

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function QuestionSheet({
  set,
  answers,
  onAnswer,
}: {
  set: PracticeSet;
  answers: Record<string, string>;
  onAnswer: (id: string, answer: string) => void;
}) {
  return (
    <div className={styles.mockQuestions}>
      {set.questions.map((question, index) => (
        <fieldset key={question.id}>
          <legend>
            {index + 1}. {question.prompt}
          </legend>
          {question.options ? (
            <div>
              {question.options.map((option) => (
                <label key={option}>
                  <input
                    type="radio"
                    name={question.id}
                    checked={answers[question.id] === option}
                    onChange={() => onAnswer(question.id, option)}
                  />
                  {option}
                </label>
              ))}
            </div>
          ) : (
            <input
              className={ui.input}
              value={answers[question.id] ?? ""}
              onChange={(event) =>
                onAnswer(question.id, event.target.value)
              }
            />
          )}
        </fieldset>
      ))}
    </div>
  );
}

export function MockExam({
  listeningSet,
  readingSet,
}: {
  listeningSet: PracticeSet;
  readingSet: PracticeSet;
}) {
  const [stage, setStage] = useState<Stage>("briefing");
  const [listeningAnswers, setListeningAnswers] = useState<
    Record<string, string>
  >({});
  const [readingAnswers, setReadingAnswers] = useState<Record<string, string>>(
    {},
  );
  const [essay, setEssay] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [sectionStarted, setSectionStarted] = useState(0);
  const [startedAt, setStartedAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<MockResult | null>(null);
  const sectionDurations = useRef({
    listening: 0,
    reading: 0,
    writing: 0,
  });

  useEffect(() => {
    if (stage === "briefing" || stage === "result") return;
    const timer = window.setInterval(() => {
      setElapsed(Math.round((Date.now() - sectionStarted) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [stage, sectionStarted]);

  useEffect(
    () => () => {
      window.speechSynthesis?.cancel();
    },
    [],
  );

  const stageIndex = ["listening", "reading", "writing"].indexOf(stage);
  const essayWords = useMemo(
    () => essay.trim().split(/\s+/).filter(Boolean).length,
    [essay],
  );

  function start() {
    const now = new Date().toISOString();
    setStartedAt(now);
    setSectionStarted(Date.now());
    setElapsed(0);
    setStage("listening");
  }

  function move(next: Stage) {
    if (stage === "listening" || stage === "reading" || stage === "writing") {
      sectionDurations.current[stage] = elapsed;
    }
    window.speechSynthesis?.cancel();
    setStage(next);
    setSectionStarted(Date.now());
    setElapsed(0);
  }

  function playAudio() {
    window.speechSynthesis?.cancel();
    const utterance = new SpeechSynthesisUtterance(listeningSet.transcript);
    utterance.lang = "en-GB";
    utterance.rate = 0.94;
    window.speechSynthesis?.speak(utterance);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sectionDurations.current.writing = elapsed;
    setBusy(true);
    setError("");
    const response = await fetch("/api/mock-exam", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startedAt,
        listening: {
          setId: listeningSet.id,
          answers: listeningAnswers,
          durationSeconds: sectionDurations.current.listening,
        },
        reading: {
          setId: readingSet.id,
          answers: readingAnswers,
          durationSeconds: sectionDurations.current.reading,
        },
        writing: {
          taskType: "task-2",
          prompt: writingPrompt,
          essay,
        },
      }),
    });
    const payload = (await response.json()) as MockResult & { error?: string };
    if (response.ok) {
      setResult(payload);
      move("result");
    } else {
      setError(payload.error ?? "Mock submission failed.");
    }
    setBusy(false);
  }

  if (stage === "briefing") {
    return (
      <div className={ui.page}>
        <header className={ui.pageHeader}>
          <div>
            <p className={ui.eyebrow}>Computer-delivered simulation</p>
            <h1>Full IELTS study mock</h1>
            <p>
              按你的要求不包含口语：Listening → Reading → Writing。内置为原创短版套题，用来验证流程和建立基线。
            </p>
          </div>
        </header>
        <section className={`${ui.panel} ${ui.panelDark} ${styles.briefing}`}>
          <div>
            <p className={ui.eyebrow}>Before you begin</p>
            <h2>Close distractions. Finish in one sitting.</h2>
            <p>
              各部分切换后不能返回。听力只播放一次；阅读和写作均计时；最终一次性保存成绩、作文反馈和错题。
            </p>
            <button className={ui.buttonSecondary} type="button" onClick={start}>
              Enter exam room
            </button>
          </div>
          <div className={styles.examSequence}>
            {[
              ["01", "Listening", `${listeningSet.questions.length} questions`],
              ["02", "Reading", `${readingSet.questions.length} questions`],
              ["03", "Writing", "Task 2 essay"],
            ].map(([number, label, detail]) => (
              <div key={number}>
                <span>{number}</span>
                <strong>{label}</strong>
                <small>{detail}</small>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  if (stage === "result" && result) {
    return (
      <div className={ui.page}>
        <header className={ui.pageHeader}>
          <div>
            <p className={ui.eyebrow}>Mock complete</p>
            <h1>Your evidence report</h1>
            <p>这是一份学习估算。错误已送入 Review，作文已保存到 Writing。</p>
          </div>
          <span className={ui.statusPill}>Saved locally</span>
        </header>
        <section className={`${ui.panel} ${ui.panelDark} ${styles.resultHero}`}>
          <div>
            <small>Estimated overall</small>
            <strong>{result.mock.overallBand.toFixed(1)}</strong>
          </div>
          <div className={styles.resultSkills}>
            <span>
              Listening <b>{result.listening.bandScore.toFixed(1)}</b>
            </span>
            <span>
              Reading <b>{result.reading.bandScore.toFixed(1)}</b>
            </span>
            <span>
              Writing <b>{result.writing.overallBand.toFixed(1)}</b>
            </span>
          </div>
          <Link className={ui.buttonSecondary} href="/review">
            Review mistakes
          </Link>
        </section>
        <div className={ui.grid2}>
          <section className={ui.panel}>
            <p className={ui.eyebrow}>Writing strengths</p>
            <h2>What worked</h2>
            <ul>
              {result.writing.strengths.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
          <section className={ui.panel}>
            <p className={ui.eyebrow}>Next actions</p>
            <h2>What to revise</h2>
            <ul>
              {result.writing.improvements.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    );
  }

  return (
    <form className={styles.examRoom} onSubmit={submit}>
      <header className={styles.examToolbar}>
        <div>
          <strong>ISTS Mock #01</strong>
          <small>
            Section {stageIndex + 1}/3 · {stage}
          </small>
        </div>
        <nav>
          {["Listening", "Reading", "Writing"].map((label, index) => (
            <span
              key={label}
              data-state={
                index === stageIndex
                  ? "current"
                  : index < stageIndex
                    ? "done"
                    : "future"
              }
            >
              {index + 1} {label}
            </span>
          ))}
        </nav>
        <time>{formatTime(elapsed)}</time>
      </header>

      {stage === "listening" && (
        <div className={styles.mockSplit}>
          <section className={`${ui.panel} ${styles.audioExam}`}>
            <div>
              <span>▶</span>
            </div>
            <h1>{listeningSet.title}</h1>
            <p>Read the questions, then play the recording once.</p>
            <button
              className={ui.buttonSecondary}
              type="button"
              onClick={playAudio}
            >
              Play recording once
            </button>
          </section>
          <section className={`${ui.panel} ${styles.mockScroll}`}>
            <QuestionSheet
              set={listeningSet}
              answers={listeningAnswers}
              onAnswer={(id, answer) =>
                setListeningAnswers((current) => ({
                  ...current,
                  [id]: answer,
                }))
              }
            />
            <button
              className={ui.button}
              type="button"
              onClick={() => move("reading")}
            >
              Submit section & continue
            </button>
          </section>
        </div>
      )}

      {stage === "reading" && (
        <div className={styles.mockSplit}>
          <section className={`${ui.panel} ${styles.mockScroll}`}>
            <h1>{readingSet.title}</h1>
            {readingSet.passage.split("\n\n").map((paragraph, index) => (
              <p className={styles.mockPassage} key={index}>
                {paragraph}
              </p>
            ))}
          </section>
          <section className={`${ui.panel} ${styles.mockScroll}`}>
            <QuestionSheet
              set={readingSet}
              answers={readingAnswers}
              onAnswer={(id, answer) =>
                setReadingAnswers((current) => ({
                  ...current,
                  [id]: answer,
                }))
              }
            />
            <button
              className={ui.button}
              type="button"
              onClick={() => move("writing")}
            >
              Submit section & continue
            </button>
          </section>
        </div>
      )}

      {stage === "writing" && (
        <section className={`${ui.panel} ${styles.writingExam}`}>
          <div>
            <p className={ui.eyebrow}>Writing Task 2</p>
            <h1>{writingPrompt}</h1>
            <p>Write at least 250 words.</p>
            <span>{essayWords} words</span>
          </div>
          <textarea
            value={essay}
            onChange={(event) => setEssay(event.target.value)}
            placeholder="Write your essay…"
          />
          {error && <div className={ui.error}>{error}</div>}
          <button
            className={ui.button}
            type="submit"
            disabled={busy || essay.trim().length < 40}
          >
            {busy ? "Scoring full mock…" : "Finish and submit mock"}
          </button>
        </section>
      )}
    </form>
  );
}

