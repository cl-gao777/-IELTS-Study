"use client";
import Link from "next/link";
import { FormEvent, useState } from "react";
import type { SourceMaterial } from "@/lib/domain";
import type { MaterialMetadata } from "@/lib/learning-workspace";
import ui from "./page-ui.module.css";
import styles from "./materials.module.css";

export function MaterialsWorkspace({ initialMaterials, metadata = {} }: { initialMaterials: SourceMaterial[]; metadata?: Record<number, MaterialMetadata> }) {
  const [materials, setMaterials] = useState(initialMaterials);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("");
  const [difficulty, setDifficulty] = useState("");
  async function importMaterial(event: FormEvent<HTMLFormElement>, file: boolean) {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = event.currentTarget; const data = new FormData(form);
    try {
      const response = await fetch(file ? "/api/materials/file" : "/api/materials", file ? { method: "POST", body: data } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(data.entries())) });
      const payload = await response.json();
      if (!response.ok || !payload.material) throw new Error(payload.error || "导入失败");
      setMaterials((current) => [payload.material, ...current]); form.reset();
      setMessage("已保存到本地。打开资料即可阅读、编辑 Transcript 或手工添加题目。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "无法连接本地服务器；输入已保留，请重试。"); }
    finally { setBusy(false); }
  }
  const filtered = materials.filter((material) => (!kind || material.kind === kind) && (!difficulty || metadata[material.id]?.difficulty === difficulty) && [material.title, material.content, metadata[material.id]?.tags.join(" ") || ""].join(" ").toLowerCase().includes(query.toLowerCase()));
  return <div className={ui.page}>
    <header className={ui.pageHeader}><div><p className={ui.eyebrow}>Bring Your Own Materials</p><h1>Materials · 资料库</h1><p>导入你自有或获准使用的材料。文本、文件、标注、音频和学习记录保存在本机。</p></div><span className={ui.pill}>{materials.length} 份资料</span></header>
    {message && <p className={ui.notice} role="status">{message}</p>}
    <div className={styles.materialGrid}><div className={ui.stack}>
      <form className={ui.panel + " " + ui.formGrid} onSubmit={(event) => importMaterial(event, true)}>
        <h2>导入文件</h2><p>TXT · Markdown · HTML · PDF · DOCX · 图片 · MP3 / WAV / M4A，单个文件 ≤25 MB。扫描 PDF 请补充可复制文本。</p>
        <label className={ui.field}>标题（可选）<input className={ui.input} name="title" /></label>
        <label className={ui.field}>资料类型<MaterialKindSelect /></label>
        <label className={ui.field}>本地文件<input className={ui.input} name="file" type="file" accept=".pdf,.docx,.txt,.md,.html,.htm,.csv,.tsv,image/*,.mp3,.wav,.m4a,.ogg,.webm" required /></label>
        <label className={ui.field}>来源 URL（可选）<input className={ui.input} name="sourceUrl" type="url" /></label>
        <button className={ui.button} disabled={busy}>{busy ? "正在保存…" : "导入本地文件"}</button>
      </form>
      <form className={ui.panel + " " + ui.formGrid} onSubmit={(event) => importMaterial(event, false)}>
        <h2>粘贴文本</h2><label className={ui.field}>标题<input className={ui.input} name="title" required /></label>
        <label className={ui.field}>资料类型<MaterialKindSelect /></label>
        <label className={ui.field}>来源 URL（可选）<input className={ui.input} name="sourceUrl" type="url" /></label>
        <label className={ui.field}>文章 / Transcript / Prompt<textarea className={ui.textarea + " " + styles.materialInput} name="content" required placeholder="粘贴英文文章、听力稿或写作题目…" /></label>
        <button className={ui.buttonSecondary} disabled={busy}>{busy ? "正在保存…" : "保存文本资料"}</button>
      </form>
    </div><section className={ui.panel}>
      <h2>我的资料</h2><div className={styles.filters}>
        <input className={ui.input} aria-label="搜索资料或标签" placeholder="搜索标题、内容或标签…" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select className={ui.select} aria-label="按类型筛选" value={kind} onChange={(event) => setKind(event.target.value)}><option value="">所有类型</option><option value="reading">Reading</option><option value="listening">Listening</option><option value="writing">Writing</option><option value="vocabulary">Vocabulary</option></select>
        <select className={ui.select} aria-label="按难度筛选" value={difficulty} onChange={(event) => setDifficulty(event.target.value)}><option value="">所有难度</option>{["基础", "中等", "挑战", "未分类"].map((value) => <option key={value}>{value}</option>)}</select>
      </div><div className={styles.materialList}>
        {filtered.map((material) => <article key={material.id} className={styles.materialCard}><div><strong>{material.title}</strong><small>{material.kind} · {material.fileName || "文本"} · {new Date(material.createdAt).toLocaleDateString("zh-CN")}</small><small>{metadata[material.id]?.tags.join(" · ")} {metadata[material.id]?.difficulty}</small></div><p>{material.content.slice(0, 150) || "本地音频 · 可以补充 Transcript 并开始精听"}{material.content.length > 150 ? "…" : ""}</p><Link className={ui.buttonGhost} href={"/materials/" + material.id}>打开资料 →</Link></article>)}
        {!filtered.length && <p className={ui.empty}>还没有匹配的资料。导入文章或音频后即可开始学习。</p>}
      </div></section></div>
  </div>;
}
function MaterialKindSelect() { return <select className={ui.select} name="kind"><option value="reading">Reading · 阅读文章</option><option value="listening">Listening · 音频 / Transcript</option><option value="writing">Writing · 写作题目</option><option value="vocabulary">Vocabulary · 单词资料</option></select>; }
