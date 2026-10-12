import type { VocabularyTargetSnapshot } from "@/lib/vocabulary-target";
import styles from "./vocabulary.module.css";

export function VocabularyTargetDetails({ target }: { target: VocabularyTargetSnapshot }) {
  return <details className={styles.wordDetails}>
    <summary>这个用法的难度参考与来源</summary>
    <dl className={styles.details}>
      {target.level && <><dt>难度参考</dt><dd>{target.level} · {target.partOfSpeech}</dd></>}
      {target.advancedReason && <><dt>收录理由</dt><dd>{target.advancedReason}</dd></>}
      {target.source && <><dt>释义来源</dt><dd>{target.source}</dd></>}
      {target.levelEvidence.map((reference, index) => <div key={`${reference.source}:${index}`}><dt>{reference.scope === "sense" ? "用法依据" : reference.scope === "headword-pos" ? "词条参考" : "编辑判断"}</dt><dd>{reference.url ? <a href={reference.url} target="_blank" rel="noreferrer">{reference.source}</a> : reference.source} · {reference.level}{reference.note && <p>{reference.note}</p>}</dd></div>)}
      {target.sourcePdf && <><dt>本地资料</dt><dd><a href={`${target.sourcePdf.attachmentUrl}#page=${target.sourcePdf.pdfPage}`} target="_blank" rel="noreferrer">查看 PDF 第 {target.sourcePdf.pdfPage} 页</a><p>{target.sourcePdf.quote}</p></dd></>}
    </dl>
    <p className={styles.small}>词条与词性的 B2 / C1 仅作难度参考，具体用法按释义与收录理由核对。</p>
  </details>;
}
