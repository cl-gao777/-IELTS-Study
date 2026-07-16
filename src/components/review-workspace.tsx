"use client";

import { useState } from "react";

import type { ReviewItem } from "@/lib/domain";

import ui from "./page-ui.module.css";
import styles from "./review.module.css";

export function ReviewWorkspace({
  initialItems,
}: {
  initialItems: ReviewItem[];
}) {
  const [items, setItems] = useState(initialItems);
  const [open, setOpen] = useState<number[]>([]);

  async function resolve(id: number) {
    const response = await fetch(`/api/review/${id}/resolve`, {
      method: "POST",
    });
    if (response.ok) {
      setItems((current) => current.filter((item) => item.id !== id));
    }
  }

  return (
    <div className={ui.page}>
      <header className={ui.pageHeader}>
        <div>
          <p className={ui.eyebrow}>Error-driven learning</p>
          <h1>Review queue</h1>
          <p>
            每个条目来自你真实提交过的答案。先回忆，再展开正确答案和证据；确认理解后归档。
          </p>
        </div>
        <span className={ui.pill}>{items.length} unresolved</span>
      </header>

      <div className={styles.reviewGrid}>
        <section className={ui.panel}>
          <div className={ui.panelHeader}>
            <div>
              <p className={ui.eyebrow}>Mistakes</p>
              <h2>Active recall queue</h2>
            </div>
          </div>
          {items.length === 0 ? (
            <div className={ui.empty}>
              队列已清空。完成一次 Reading、Listening 或 Mock 后，错题会自动出现在这里。
            </div>
          ) : (
            <div className={styles.reviewList}>
              {items.map((item, index) => {
                const revealed = open.includes(item.id);
                return (
                  <article key={item.id}>
                    <header>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <div>
                        <small>{item.skill}</small>
                        <strong>{item.prompt}</strong>
                      </div>
                    </header>
                    {revealed && (
                      <div className={styles.reviewAnswer}>
                        <small>Answer & evidence</small>
                        <p>{item.answer}</p>
                      </div>
                    )}
                    <footer>
                      <button
                        className={ui.buttonGhost}
                        type="button"
                        onClick={() =>
                          setOpen((current) =>
                            current.includes(item.id)
                              ? current.filter((id) => id !== item.id)
                              : [...current, item.id],
                          )
                        }
                      >
                        {revealed ? "Hide answer" : "Reveal answer"}
                      </button>
                      <button
                        className={ui.button}
                        type="button"
                        onClick={() => resolve(item.id)}
                        disabled={!revealed}
                      >
                        I understand this
                      </button>
                    </footer>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <aside className={ui.stack}>
          <section className={`${ui.panel} ${ui.panelDark}`}>
            <p className={ui.eyebrow}>Review protocol</p>
            <h2>不要只“看懂”</h2>
            <p>
              1. 不看答案重做。2. 找到原文证据。3. 说清错误原因。4.
              写一个可迁移的规则。
            </p>
          </section>
          <section className={ui.panel}>
            <p className={ui.eyebrow}>Ask 小C</p>
            <h2>把错误变成英语</h2>
            <p>
              复制问题给小C，要求她用英文解释你为什么会错，并生成一道相似题。
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}

