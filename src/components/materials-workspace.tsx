"use client";

import { FormEvent, useState } from "react";

import type { SourceMaterial } from "@/lib/domain";

import ui from "./page-ui.module.css";
import styles from "./materials.module.css";

export function MaterialsWorkspace({
  initialMaterials,
}: {
  initialMaterials: SourceMaterial[];
}) {
  const [materials, setMaterials] = useState(initialMaterials);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [generatingId, setGeneratingId] = useState(0);
  const [generatedHref, setGeneratedHref] = useState("");

  async function importMaterial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const response = await fetch("/api/materials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: data.get("title"),
        kind: data.get("kind"),
        sourceUrl: data.get("sourceUrl"),
        content: data.get("content"),
      }),
    });
    const payload = (await response.json()) as {
      material?: SourceMaterial;
      error?: string;
    };
    if (response.ok && payload.material) {
      setMaterials((current) => [payload.material!, ...current]);
      setMessage("材料已保存到本地资料库。");
      form.reset();
    } else {
      setMessage(payload.error ?? "导入失败。");
    }
    setBusy(false);
  }

  async function uploadMaterial(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = event.currentTarget;
    const response = await fetch("/api/materials/file", {
      method: "POST",
      body: new FormData(form),
    });
    const payload = (await response.json()) as {
      material?: SourceMaterial;
      error?: string;
    };
    if (response.ok && payload.material) {
      setMaterials((current) => [payload.material!, ...current]);
      setMessage(
        payload.material.content.startsWith("Audio source")
          ? "音频已保存。你可以在资料库直接播放，并继续补充听力稿。"
          : "文件已保存，支持的文档文本也已提取。",
      );
      form.reset();
    } else {
      setMessage(payload.error ?? "文件导入失败。");
    }
    setBusy(false);
  }

  async function generatePractice(material: SourceMaterial) {
    setGeneratingId(material.id);
    setGeneratedHref("");
    setMessage("");
    const response = await fetch(`/api/materials/${material.id}/practice`, {
      method: "POST",
    });
    const payload = (await response.json()) as {
      error?: string;
      href?: string;
      provider?: string;
    };
    if (response.ok && payload.href) {
      setGeneratedHref(payload.href);
      setMessage(`练习已生成（${payload.provider ?? "AI"}），可以立即开始。`);
    } else {
      setMessage(payload.error ?? "无法生成练习。");
    }
    setGeneratingId(0);
  }

  return (
    <div className={ui.page}>
      <header className={ui.pageHeader}>
        <div>
          <p className={ui.eyebrow}>Your licensed source library</p>
          <h1>Learning materials</h1>
          <p>
            粘贴你拥有或获准使用的文本、题目、听力稿和单词表。公开仓库不捆绑受版权保护的真题。
          </p>
        </div>
        <span className={ui.pill}>{materials.length} imported</span>
      </header>

      {message && (
        <div className={ui.notice}>
          {message}{" "}
          {generatedHref && <a href={generatedHref}>Open generated drill →</a>}
        </div>
      )}

      <div className={styles.materialGrid}>
        <div className={ui.stack}>
          <form
            className={`${ui.panel} ${ui.formGrid}`}
            onSubmit={uploadMaterial}
          >
            <div className={ui.panelHeader}>
              <div>
                <p className={ui.eyebrow}>File import</p>
                <h2>Upload PDF, Word, image or audio</h2>
              </div>
            </div>
            <div className={ui.formGrid2}>
              <div className={ui.field}>
                <label htmlFor="file-title">Title (optional)</label>
                <input className={ui.input} id="file-title" name="title" />
              </div>
              <div className={ui.field}>
                <label htmlFor="file-kind">Type</label>
                <select className={ui.select} id="file-kind" name="kind">
                  <option value="reading">Reading</option>
                  <option value="listening">Listening / audio</option>
                  <option value="writing">Writing prompt</option>
                  <option value="vocabulary">Vocabulary</option>
                </select>
              </div>
            </div>
            <div className={ui.field}>
              <label htmlFor="source-file">File · max 25 MB</label>
              <input
                className={ui.input}
                id="source-file"
                name="file"
                type="file"
                accept=".pdf,.docx,.txt,.md,.csv,.tsv,image/*,audio/*"
                required
              />
            </div>
            <div className={ui.field}>
              <label htmlFor="file-source-url">Source URL (optional)</label>
              <input
                className={ui.input}
                id="file-source-url"
                name="sourceUrl"
                type="url"
              />
            </div>
            <button className={ui.buttonSecondary} type="submit" disabled={busy}>
              {busy ? "Uploading…" : "Upload and extract"}
            </button>
          </form>

          <form
            className={`${ui.panel} ${ui.formGrid}`}
            onSubmit={importMaterial}
          >
            <div className={ui.panelHeader}>
              <div>
                <p className={ui.eyebrow}>Paste text</p>
                <h2>Add editable source material</h2>
              </div>
            </div>
            <div className={ui.formGrid2}>
              <div className={ui.field}>
                <label htmlFor="material-title">Title</label>
                <input
                  className={ui.input}
                  id="material-title"
                  name="title"
                  required
                />
              </div>
              <div className={ui.field}>
                <label htmlFor="material-kind">Type</label>
                <select className={ui.select} id="material-kind" name="kind">
                  <option value="reading">Reading</option>
                  <option value="listening">Listening transcript</option>
                  <option value="writing">Writing prompt</option>
                  <option value="vocabulary">Vocabulary list</option>
                </select>
              </div>
            </div>
            <div className={ui.field}>
              <label htmlFor="material-url">Source URL (optional)</label>
              <input
                className={ui.input}
                id="material-url"
                name="sourceUrl"
                type="url"
              />
            </div>
            <div className={ui.field}>
              <label htmlFor="material-content">Content</label>
              <textarea
                className={`${ui.textarea} ${styles.materialInput}`}
                id="material-content"
                name="content"
                required
                placeholder="Paste a passage, transcript, prompt or tab-separated word list…"
              />
            </div>
            <button className={ui.button} type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save material"}
            </button>
          </form>
        </div>

        <section className={ui.panel}>
          <div className={ui.panelHeader}>
            <div>
              <p className={ui.eyebrow}>Library</p>
              <h2>Imported sources</h2>
            </div>
          </div>
          {materials.length ? (
            <div className={styles.materialList}>
              {materials.map((material) => (
                <details key={material.id}>
                  <summary>
                    <span>
                      <strong>{material.title}</strong>
                      <small>
                        {material.kind} ·{" "}
                        {new Date(material.createdAt).toLocaleDateString(
                          "zh-CN",
                        )}
                      </small>
                    </span>
                    <i>{material.content.length} chars</i>
                  </summary>
                  <pre>{material.content}</pre>
                  {material.mimeType.startsWith("audio/") &&
                    material.fileUrl && (
                      <audio controls src={material.fileUrl}>
                        Your browser does not support audio playback.
                      </audio>
                    )}
                  {material.mimeType.startsWith("image/") &&
                    material.fileUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        className={styles.previewImage}
                        src={material.fileUrl}
                        alt={material.title}
                      />
                    )}
                  {material.fileUrl && (
                    <a href={material.fileUrl} target="_blank" rel="noreferrer">
                      Open imported file ↗
                    </a>
                  )}
                  {material.sourceUrl && (
                    <a
                      href={material.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open source ↗
                    </a>
                  )}
                  {["reading", "listening"].includes(material.kind) &&
                    material.content.length >= 100 && (
                      <button
                        className={ui.buttonGhost}
                        type="button"
                        onClick={() => generatePractice(material)}
                        disabled={generatingId === material.id}
                      >
                        {generatingId === material.id
                          ? "Generating…"
                          : "Generate editable practice"}
                      </button>
                    )}
                </details>
              ))}
            </div>
          ) : (
            <div className={ui.empty}>
              No imported material. The built-in original drills remain available
              under Practice.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
