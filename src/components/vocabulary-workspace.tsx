"use client";

import { FormEvent, useMemo, useState } from "react";

import type { VocabularyWord } from "@/lib/domain";
import type { ReviewRating } from "@/lib/srs";

import ui from "./page-ui.module.css";
import styles from "./study-tools.module.css";

const ratings: Array<{
  value: ReviewRating;
  label: string;
  hint: string;
}> = [
  { value: "again", label: "Again", hint: "10 min" },
  { value: "hard", label: "Hard", hint: "short" },
  { value: "good", label: "Good", hint: "normal" },
  { value: "easy", label: "Easy", hint: "long" },
];

export function VocabularyWorkspace({
  initialWords,
  nowIso,
}: {
  initialWords: VocabularyWord[];
  nowIso: string;
}) {
  const [words, setWords] = useState(initialWords);
  const [selectedId, setSelectedId] = useState(initialWords[0]?.id ?? "");
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const now = new Date(nowIso).getTime();

  const dueWords = useMemo(
    () =>
      words.filter((word) => new Date(word.dueAt).getTime() <= now),
    [now, words],
  );
  const selected =
    words.find((word) => word.id === selectedId) ?? dueWords[0] ?? words[0];
  const filtered = words.filter(
    (word) =>
      word.term.toLowerCase().includes(query.toLowerCase()) ||
      word.meaningZh.includes(query),
  );

  async function review(rating: ReviewRating) {
    if (!selected || busy) return;
    setBusy(true);
    const response = await fetch(
      `/api/vocabulary/${encodeURIComponent(selected.id)}/review`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating }),
      },
    );
    if (response.ok) {
      const payload = (await response.json()) as { word: VocabularyWord };
      setWords((current) =>
        current.map((word) =>
          word.id === payload.word.id ? payload.word : word,
        ),
      );
      const next = dueWords.find((word) => word.id !== selected.id);
      if (next) setSelectedId(next.id);
      setRevealed(false);
      setMessage(
        `${selected.term} 已安排下次复习：${new Date(payload.word.dueAt).toLocaleString("zh-CN")}`,
      );
    }
    setBusy(false);
  }

  async function addWord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/vocabulary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        term: data.get("term"),
        pronunciation: data.get("pronunciation"),
        partOfSpeech: data.get("partOfSpeech"),
        meaningZh: data.get("meaningZh"),
        definitionEn: data.get("definitionEn"),
        example: data.get("example"),
        tags: String(data.get("tags") ?? "")
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      }),
    });
    const payload = (await response.json()) as {
      word?: VocabularyWord;
      error?: string;
    };
    if (response.ok && payload.word) {
      setWords((current) => [payload.word!, ...current]);
      setSelectedId(payload.word.id);
      setShowAdd(false);
      setMessage("新单词已加入今日复习。");
      event.currentTarget.reset();
    } else {
      setMessage(payload.error ?? "无法添加单词。");
    }
  }

  return (
    <div className={ui.page}>
      <header className={ui.pageHeader}>
        <div>
          <p className={ui.eyebrow}>Spaced repetition</p>
          <h1>Vocabulary memory lab</h1>
          <p>
            先主动回忆，再显示答案。评分会决定下一次出现时间，所有记录保存在本地 SQLite。
          </p>
        </div>
        <div className={ui.headerActions}>
          <span className={ui.pill}>{dueWords.length} due now</span>
          <button
            className={ui.button}
            type="button"
            onClick={() => setShowAdd((current) => !current)}
          >
            + Add word
          </button>
        </div>
      </header>

      {showAdd && (
        <form className={`${ui.panel} ${styles.addWordForm}`} onSubmit={addWord}>
          <div className={ui.formGrid2}>
            <div className={ui.field}>
              <label htmlFor="term">Word</label>
              <input className={ui.input} id="term" name="term" required />
            </div>
            <div className={ui.field}>
              <label htmlFor="pronunciation">Pronunciation</label>
              <input
                className={ui.input}
                id="pronunciation"
                name="pronunciation"
              />
            </div>
            <div className={ui.field}>
              <label htmlFor="partOfSpeech">Part of speech</label>
              <input
                className={ui.input}
                id="partOfSpeech"
                name="partOfSpeech"
              />
            </div>
            <div className={ui.field}>
              <label htmlFor="meaningZh">中文释义</label>
              <input
                className={ui.input}
                id="meaningZh"
                name="meaningZh"
                required
              />
            </div>
          </div>
          <div className={ui.field}>
            <label htmlFor="definitionEn">English definition</label>
            <input
              className={ui.input}
              id="definitionEn"
              name="definitionEn"
              required
            />
          </div>
          <div className={ui.field}>
            <label htmlFor="example">Example sentence</label>
            <input
              className={ui.input}
              id="example"
              name="example"
              required
            />
          </div>
          <div className={ui.field}>
            <label htmlFor="tags">Tags, separated by commas</label>
            <input className={ui.input} id="tags" name="tags" />
          </div>
          <button className={ui.buttonSecondary} type="submit">
            Save to deck
          </button>
        </form>
      )}

      {message && <div className={ui.notice}>{message}</div>}

      <div className={styles.vocabularyLayout}>
        <section
          className={`${ui.panel} ${ui.panelDark} ${styles.reviewCard}`}
        >
          {selected ? (
            <>
              <div className={styles.wordMeta}>
                <span>{selected.partOfSpeech || "word"}</span>
                <span>Review #{selected.repetitions + 1}</span>
              </div>
              <div className={styles.wordFront}>
                <small>{selected.pronunciation}</small>
                <h2>{selected.term}</h2>
                <p>先在脑中说出释义和一个句子，再点击显示答案。</p>
              </div>
              {!revealed ? (
                <button
                  className={ui.buttonSecondary}
                  type="button"
                  onClick={() => setRevealed(true)}
                >
                  Reveal answer
                </button>
              ) : (
                <div className={styles.wordBack}>
                  <strong>{selected.meaningZh}</strong>
                  <p>{selected.definitionEn}</p>
                  <blockquote>{selected.example}</blockquote>
                  <div className={styles.ratingGrid}>
                    {ratings.map((rating) => (
                      <button
                        type="button"
                        key={rating.value}
                        disabled={busy}
                        onClick={() => review(rating.value)}
                      >
                        <strong>{rating.label}</strong>
                        <small>{rating.hint}</small>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className={ui.empty}>No words in this deck yet.</div>
          )}
        </section>

        <aside className={ui.panel}>
          <div className={ui.panelHeader}>
            <div>
              <p className={ui.eyebrow}>Deck</p>
              <h2>{words.length} saved words</h2>
            </div>
          </div>
          <input
            className={ui.input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search word or 中文释义"
          />
          <div className={styles.wordList}>
            {filtered.map((word) => (
              <button
                className={word.id === selected?.id ? styles.selectedWord : ""}
                type="button"
                key={word.id}
                onClick={() => {
                  setSelectedId(word.id);
                  setRevealed(false);
                }}
              >
                <span>
                  <strong>{word.term}</strong>
                  <small>{word.meaningZh}</small>
                </span>
                <i
                  data-due={
                    new Date(word.dueAt).getTime() <= now
                      ? "due"
                      : "scheduled"
                  }
                />
              </button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
