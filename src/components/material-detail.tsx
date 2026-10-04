"use client";
import Link from "next/link";
import { useState } from "react";
import type { PracticeQuestion, QuestionKind, SourceMaterial } from "@/lib/domain";
import type { MaterialMetadata } from "@/lib/learning-workspace";
import { QUESTION_TYPES, questionKinds } from "@/lib/question-types";
import ui from "./page-ui.module.css";
import styles from "./materials.module.css";

export function MaterialDetail({ material, initialMetadata }: { material: SourceMaterial; initialMetadata: MaterialMetadata }) {
  const [title, setTitle] = useState(material.title);
  const [content, setContent] = useState(material.content.startsWith("Audio source") ? "" : material.content);
  const [sourceUrl, setSourceUrl] = useState(material.sourceUrl);
  const [metadata, setMetadata] = useState(initialMetadata);
  const [questions, setQuestions] = useState<PracticeQuestion[]>([]);
  const [duration, setDuration] = useState(20);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [href, setHref] = useState("");
  const editable = ["reading", "listening"].includes(material.kind);
  const updateQuestion = (index: number, patch: Partial<PracticeQuestion>) => setQuestions((current) => current.map((question, i) => i === index ? { ...question, ...patch } : question));
  async function save() {
    const response = await fetch(`/api/materials/${material.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, content, sourceUrl, metadata }) });
    const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "保存失败");
  }
  async function action(mode: "save" | "study" | "manual" | "ai") {
    setBusy(true); setMessage(""); setHref("");
    try {
      await save();
      if (mode === "save") { setMessage("资料与 Transcript 已保存到本地。"); return; }
      const response = await fetch(`/api/materials/${material.id}/${mode === "ai" ? "practice" : "manual-practice"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ durationMinutes: duration, questions: mode === "manual" ? questions : [] }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "创建练习失败");
      if (mode === "study") { window.location.href = payload.href; return; }
      setHref(payload.href); setMessage(mode === "ai" ? (payload.provider === "local-generation" ? "AI 未连接，已使用原文生成本地填空练习。" : "AI 练习已生成，请核对原文与参考答案后使用。") : "练习已创建，参考答案保存在本地，可直接评分。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "本地服务器无法连接，输入仍保留在当前页面。"); }
    finally { setBusy(false); }
  }
  return <div className={ui.page} data-source-material={material.title}>
    <header className={ui.pageHeader}><div><p className={ui.eyebrow}>{material.kind} · Source Material #{material.id}</p><h1>{material.title}</h1><p>保存资料后即可开始学习；手动题目、评分、笔记和精听不需要 AI。</p></div><Link className={ui.buttonGhost} href="/materials">← 资料库</Link></header>
    {message && <div className={ui.notice} role="status">{message} {href && <Link href={href}>打开练习 →</Link>}</div>}
    <div className={styles.materialGrid}><section className={`${ui.panel} ${ui.formGrid}`}>
      <label className={ui.field}>标题<input className={ui.input} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      {material.mimeType.startsWith("audio/") && <audio className={styles.audio} controls src={material.fileUrl} />}
      {material.mimeType.startsWith("image/") && <figure>{/* eslint-disable-next-line @next/next/no-img-element */}
<img className={styles.previewImage} src={material.fileUrl} alt={material.title} /><figcaption>图片引用：{material.fileUrl}（可填入图示题图片路径）</figcaption></figure>}
      {material.fileUrl && <a href={material.fileUrl} target="_blank" rel="noreferrer">打开原始文件 ↗</a>}
      <label className={ui.field}>{material.kind === "listening" ? "Transcript · 可编辑听力稿" : "Content · 原文"}<textarea className={`${ui.textarea} ${styles.materialInput}`} value={content} onChange={(event) => setContent(event.target.value)} placeholder="手动粘贴或修正文本；不需要语音识别 API。" /></label>
      {material.kind === "listening" && <label className={ui.field}>从 TXT / Markdown 导入 Transcript<input className={ui.input} type="file" accept=".txt,.md" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 500000) { setMessage("Transcript 不能超过 500 KB。"); return; } try { setContent(await file.text()); setMessage("Transcript 已载入，请保存资料。"); } catch { setMessage("读取文件失败。"); } }} /></label>}
      <label className={ui.field}>来源 URL<input className={ui.input} value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} /></label>
      <label className={ui.field}>来源 / 使用许可说明<input className={ui.input} value={metadata.provenance} onChange={(event) => setMetadata({ ...metadata, provenance: event.target.value })} /></label>
      <label className={ui.field}>标签（逗号分隔）<input className={ui.input} value={metadata.tags.join(",")} onChange={(event) => setMetadata({ ...metadata, tags: event.target.value.split(/[,，]/) })} /></label>
      <div className={ui.formGrid2}><label className={ui.field}>难度<select className={ui.select} value={metadata.difficulty} onChange={(event) => setMetadata({ ...metadata, difficulty: event.target.value })}>{["未分类", "基础", "中等", "挑战"].map((value) => <option key={value}>{value}</option>)}</select></label><label className={ui.field}>IELTS Section<input className={ui.input} placeholder="Passage 1 / Section 3" value={metadata.section} onChange={(event) => setMetadata({ ...metadata, section: event.target.value })} /></label></div>
      <label className={ui.field}>资料备注<textarea className={ui.textarea} value={metadata.notes} onChange={(event) => setMetadata({ ...metadata, notes: event.target.value })} /></label>
      <div className={styles.actions}><button className={ui.button} onClick={() => action("save")} disabled={busy}>保存资料 / Transcript</button>{editable && <button className={ui.buttonSecondary} onClick={() => action("study")} disabled={busy}>{material.kind === "reading" ? "开始纯阅读" : "进入精听 / 听写"}</button>}</div>
    </section><section className={`${ui.panel} ${ui.formGrid}`}>
      {editable ? <><h2>手工录入 IELTS 题目</h2><p>每道题独立评分。填空 / 表格 / 地图的每个空格录入一题；匹配题的每个项目录入一题，共用选项可重复填写。答案须使用完整选项文本。</p>
        <label className={ui.field}>建议练习时长（分钟）<input className={ui.input} type="number" min="1" max="180" value={duration} onChange={(event) => setDuration(Number(event.target.value))} /></label>
        {questions.map((question, index) => <fieldset className={styles.questionEditor} key={question.id}><legend>Question {index + 1}</legend>
          <label className={ui.field}>题型<select className={ui.select} value={question.kind} onChange={(event) => updateQuestion(index, { kind: event.target.value as QuestionKind, options: undefined, maxWords: undefined })}>{questionKinds.map((kind) => <option value={kind} key={kind}>{QUESTION_TYPES[kind].label}</option>)}</select></label>
          <label className={ui.field}>题目 / 表格行与列说明<textarea className={ui.textarea} value={question.prompt} onChange={(event) => updateQuestion(index, { prompt: event.target.value })} /></label>
          {!["true-false-not-given", "yes-no-not-given"].includes(question.kind) && QUESTION_TYPES[question.kind].mode !== "text" && <label className={ui.field}>选项（每行一项）<textarea className={ui.textarea} value={question.options?.join("\n") || ""} onChange={(event) => updateQuestion(index, { options: event.target.value.split("\n") })} /></label>}
          <label className={ui.field}>参考答案（可接受的替代写法用 | 分隔）<input className={ui.input} value={question.answers.join("|")} onChange={(event) => updateQuestion(index, { answers: event.target.value.split("|") })} /></label>
          <label className={ui.field}>Evidence · 复制原文证据<textarea className={ui.textarea} value={question.evidence || ""} onChange={(event) => updateQuestion(index, { evidence: event.target.value })} /></label>
          <label className={ui.field}>Explanation · 解释<textarea className={ui.textarea} value={question.explanation} onChange={(event) => updateQuestion(index, { explanation: event.target.value })} /></label>
          {QUESTION_TYPES[question.kind].mode === "text" && <label className={ui.field}>最多词数（可选）<input className={ui.input} type="number" min="1" max="50" value={question.maxWords || ""} onChange={(event) => updateQuestion(index, { maxWords: event.target.value ? Number(event.target.value) : undefined })} /></label>}
          {question.kind === "map-labelling" && <label className={ui.field}>本地图片路径<input className={ui.input} value={question.imageUrl || ""} placeholder="/api/uploads/图片资料ID" onChange={(event) => updateQuestion(index, { imageUrl: event.target.value })} /></label>}
          <button className={ui.dangerButton} onClick={() => setQuestions((current) => current.filter((_, i) => i !== index))}>移除此题</button>
        </fieldset>)}
        <div className={styles.actions}><button className={ui.buttonGhost} onClick={() => setQuestions((current) => [...current, { id: crypto.randomUUID(), kind: "short-answer", prompt: "", answers: [""], explanation: "", evidence: "" }])}>＋ 添加题目</button><button className={ui.button} disabled={busy || !questions.length} onClick={() => action("manual")}>保存并创建练习</button></div>
        <hr /><h3>AI 生成题目（可选）</h3><p>在 Settings 配置 Provider 后可使用。AI 不可用时，资料与手工题目仍可使用。</p><button className={ui.buttonGhost} disabled={busy || content.length < 100} onClick={() => action("ai")}>{busy ? "处理中…" : "从当前文本生成练习"}</button>
      </> : <><h2>资料预览</h2><div className={styles.plainText}>{content}</div><p>此资料保存在本机。需要文章练习时请以 Reading 类型导入；听力材料以 Listening 类型导入。</p></>}
    </section></div>
  </div>;
}


