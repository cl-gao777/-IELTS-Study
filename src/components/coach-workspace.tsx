"use client";

import { FormEvent, useRef, useState } from "react";

import type { CoachMessage } from "@/lib/domain";

import ui from "./page-ui.module.css";
import styles from "./study-tools.module.css";

interface LiveMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  correction: string;
  provider: string;
}

export function CoachWorkspace({
  initialMessages, initialInput="",
}: {
  initialMessages: CoachMessage[]; initialInput?:string;
}) {
  const [messages, setMessages] = useState<LiveMessage[]>(
    initialMessages.map((message) => ({
      ...message,
      id: String(message.id),
    })),
  );
  const [input, setInput] = useState(initialInput);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = input.trim();
    if (!message || busy) return;

    const optimisticId = `user-${Date.now()}`;
    setMessages((current) => [
      ...current,
      {
        id: optimisticId,
        role: "user",
        content: message,
        correction: "",
        provider: "",
      },
    ]);
    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const payload = (await response.json()) as {
        error?: string;
        reply?: {
          correction: string;
          answer: string;
          followUp: string;
          provider: string;
        };
      };
      if (!response.ok || !payload.reply) {
        throw new Error(payload.error ?? "Tutor暂时没有收到这条消息。");
      }
      const reply = payload.reply;
      setInput((current) => current.trim() === message ? "" : current);
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: [reply.answer, reply.followUp]
            .filter(Boolean)
            .join("\n\n"),
          correction: reply.correction,
          provider: reply.provider,
        },
      ]);
    } catch (caught) {
      setMessages((current) => current.filter((item) => item.id !== optimisticId));
      setError(caught instanceof Error ? caught.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  function insertPrompt(prompt: string) {
    setInput(prompt);
    window.setTimeout(() => {
      formRef.current?.querySelector("textarea")?.focus();
    }, 0);
  }

  return (
    <div className={ui.page}>
      <header className={ui.pageHeader}>
        <div>
          <p className={ui.eyebrow}>CONTEXTUAL IELTS TUTOR</p>
          <h1>IELTS Tutor · IELTS Coach</h1>
          <p>
            直接说你的真实问题。中文会被转换成可复制的自然英文，英文会被轻量纠正，然后继续对话。
          </p>
        </div>
        <span className={ui.statusPill}>按需使用 AI</span>
      </header>

      <div className={styles.coachLayout}>
        <section className={`${ui.panel} ${styles.chatPanel}`}>
          <div className={styles.chatTimeline} aria-live="polite">
            {messages.length === 0 && (
              <div className={styles.welcomeMessage}>
                <span>C</span>
                <div>
                  <strong>IELTS Tutor</strong>
                  <p>
                    晚上好。试着用英语问我；卡住时直接输入中文，我会告诉你自然表达。
                  </p>
                </div>
              </div>
            )}
            {messages.map((message) => (
              <article
                className={`${styles.message} ${
                  message.role === "user"
                    ? styles.userMessage
                    : styles.assistantMessage
                }`}
                key={message.id}
              >
                <header>
                  {message.role === "user" ? "You" : "IELTS Tutor"}
                  {message.provider && <small>{message.provider}</small>}
                </header>
                {message.correction && (
                  <div className={styles.correction}>
                    <b>Natural English</b>
                    {message.correction}
                  </div>
                )}
                {message.content.split("\n").map((line, index) =>
                  line ? <p key={`${message.id}-${index}`}>{line}</p> : <br key={`${message.id}-${index}`} />,
                )}
              </article>
            ))}
            {busy && (
              <div className={styles.typing}>
                <i />
                <i />
                <i />
                Tutor正在整理表达和回答…
              </div>
            )}
          </div>

          <form className={styles.chatForm} onSubmit={submit} ref={formRef}>
            {error && <div className={ui.error}>{error}</div>}
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  formRef.current?.requestSubmit();
                }
              }}
              placeholder="Ask in English — 中文也可以。Ctrl + Enter 发送。"
              rows={4}
            />
            <div>
              <small>{input.length}/8000</small>
              <button type="submit" disabled={busy || !input.trim()}>
                {busy ? "Thinking…" : "Send to Tutor ↑"}
              </button>
            </div>
          </form>
        </section>

        <aside className={ui.stack}>
          <section className={ui.panel}>
            <div className={ui.panelHeader}>
              <div>
                <p className={ui.eyebrow}>Prompt starters</p>
                <h2>马上开始</h2>
              </div>
            </div>
            <div className={styles.promptList}>
              {[
                "我今天学习效率不高，用英语怎么自然表达？",
                "Please correct this sentence without changing my meaning: ",
                "Give me a Band 7 example for this idea: ",
                "Quiz me on the vocabulary I reviewed today.",
              ].map((prompt) => (
                <button
                  type="button"
                  key={prompt}
                  onClick={() => insertPrompt(prompt)}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </section>
          <section className={`${ui.panel} ${ui.panelDark}`}>
            <p className={ui.eyebrow}>How feedback works</p>
            <h2>不打断表达</h2>
            <p>
              Tutor只优先改最影响自然度或准确性的部分，并保留你的原意。更系统的错误会进入写作反馈或错题复盘。
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
