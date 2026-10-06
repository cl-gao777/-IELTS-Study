import Link from "next/link";
import ui from "@/components/page-ui.module.css";
import styles from "@/components/analytics.module.css";
import { QUESTION_TYPES } from "@/lib/question-types";
import type { QuestionTypeMetric } from "@/lib/learning-analytics";
import { getLearningAnalytics } from "@/server/analytics";

export const dynamic = "force-dynamic";
const percent = (value: number | null) => value === null ? "—" : `${value.toFixed(0)}%`;
function typeLabel(kind: string) { return kind in QUESTION_TYPES ? QUESTION_TYPES[kind as keyof typeof QUESTION_TYPES].label : "历史未标注题型"; }
function TypeTable({ rows }: { rows: QuestionTypeMetric[] }) {
  return rows.length ? <div className={styles.tableWrap}><table className={ui.table}><thead><tr><th>题型</th><th>正确 / 总题数</th><th>正确率</th><th>估计秒 / 题</th></tr></thead><tbody>{rows.map((row) => <tr key={row.kind}><td>{typeLabel(row.kind)}</td><td>{row.correct}/{row.total}</td><td>{percent(row.accuracy)}</td><td>{row.secondsPerQuestion.toFixed(0)}</td></tr>)}</tbody></table></div> : <div className={ui.empty}>提交实际题目后，按题型显示强项与弱项。</div>;
}
function Distribution({ rows, empty }: { rows: { label: string; count: number }[]; empty: string }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return rows.length ? <div className={styles.distribution}>{rows.map((row) => <div key={row.label}><span>{row.label}</span><div className={styles.track}><i style={{ width: `${row.count / max * 100}%` }} /></div><strong>{row.count}</strong></div>)}</div> : <div className={ui.empty}>{empty}</div>;
}

export default function AnalyticsPage() {
  const data = getLearningAnalytics();
  const recentWriting = data.writing.slice(0, 12);
  const date = (value: string) => new Intl.DateTimeFormat("zh-CN", { timeZone: data.timeZone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  const grammar = data.writing.length ? data.writing.reduce((sum, row) => sum + row.criteria.grammarAccuracy, 0) / data.writing.length : null;
  const unfinishedBaseline = !data.reading.total || !data.listening.total || !data.completedDrafts;
  const reasonCount = (rows: { count: number }[]) => rows.reduce((sum, row) => sum + row.count, 0);
  const maxMinutes = Math.max(1, ...data.study.minutesByDay.map((day) => day.minutes));
  return <div className={ui.page}>
    <header className={ui.pageHeader}><div><p className={ui.eyebrow}>Learning signals</p><h1>学习分析</h1><p>根据本地练习、复习与学习记录，决定下一次把时间投在哪里。客观正确率按实际作答样本计算，自评记录单独标明。</p></div><Link href="/" className={ui.buttonSecondary}>返回 Today</Link></header>
    <section className={`${ui.panel} ${styles.focus}`}>
      <div><p className={ui.eyebrow}>Next focus</p><h2>{data.focus.text}</h2><p>样本较少、重复作答或材料难度不同，都可能影响正确率。这些记录用于安排训练，不据此推算 IELTS 总分。</p></div><Link href={data.focus.href} className={ui.button}>开始针对练习</Link>
    </section>
    <div className={styles.metrics}>
      <div className={ui.metric}><small>Reading 正确率</small><strong>{percent(data.reading.accuracy)}</strong><span>{data.reading.correct}/{data.reading.total} 题 · {data.reading.attempts} 次练习</span></div>
      <div className={ui.metric}><small>Listening 正确率</small><strong>{percent(data.listening.accuracy)}</strong><span>{data.listening.correct}/{data.listening.total} 题 · {data.listening.attempts} 次练习</span></div>
      <div className={ui.metric}><small>今日学习</small><strong>{data.study.todayMinutes.toFixed(1)} <small className={styles.inlineUnit}>min</small></strong><span>近 7 天 {data.study.weekMinutes.toFixed(0)} 分钟 · {data.study.daysThisWeek}/7 天</span></div>
      <div className={ui.metric}><small>连续学习</small><strong>{data.study.streak} <small className={styles.inlineUnit}>天</small></strong><span>依据实际记录的前台学习时长</span></div>
    </div>
    <section className={`${ui.panel} ${styles.section}`}><p className={ui.eyebrow}>Initial assessment</p><h2>{unfinishedBaseline ? "建立你的实际学习基线" : "已收集阅读、听力与写作样本"}</h2>
      <div className={styles.baseline}><Link href="/practice/reading">Reading · {data.reading.total ? `已有 ${data.reading.total} 道作答` : "待完成第一组题目"}</Link><Link href="/practice/listening">Listening · {data.listening.total ? `已有 ${data.listening.total} 道作答` : "待完成第一组题目"}</Link><Link href="/writing">Writing · {data.completedDrafts ? `已完成 ${data.completedDrafts} 个版本` : "待完成首篇作文"}</Link></div>
      <p>无需填写 CET 或考研成绩。首轮样本帮助选择训练方向；之后用新的材料持续验证。今日已完成写作 {data.completedWritingToday} 个版本。</p>
    </section>
    <div className={`${ui.grid2} ${styles.section}`}>
      {([ ["Reading", data.reading, data.readingReasons], ["Listening", data.listening, data.listeningReasons] ] as const).map(([label, stats, reasons]) => <section className={ui.panel} key={label}>
        <p className={ui.eyebrow}>{label} profile</p><h2>{label} · 按题型定位弱项</h2><TypeTable rows={stats.byType} />
        <p>估计每题用时 = 该次练习总时长 ÷ 题数，不是逐题计时；该模块平均 {stats.secondsPerQuestion === null ? "—" : stats.secondsPerQuestion.toFixed(0)} 秒 / 题。</p>
        <h3 className={styles.subheading}>错因分布</h3><Distribution rows={reasons} empty="在练习反馈中为错题选择原因，形成个人错误档案。" />
        <p>已归因 {reasonCount(reasons)} 题；尚未归因 {Math.max(0, stats.total - stats.correct - reasonCount(reasons))} 题。</p>
      </section>)}
    </div>
    <div className={`${ui.grid2} ${styles.section}`}>
      <section className={ui.panel}><p className={ui.eyebrow}>Intensive listening</p><h2>听写差异 · {data.dictationAttempts} 次练习</h2>
        <Distribution rows={data.dictationAttempts ? [{ label: "Missing word · 漏词", count: data.dictationErrors.missing }, { label: "Extra word · 多词", count: data.dictationErrors.extra }, { label: "Wrong word · 听错", count: data.dictationErrors.wrong }, { label: "Spelling · 拼写", count: data.dictationErrors.spelling }] : []} empty="导入音频与 transcript，完成听写后查看词语级差异。" /><p>拼写分类基于字符差异启发式；可在 Mistakes 对照原文复习。</p><Link href="/review" className={ui.buttonSecondary}>进入 Mistakes</Link>
      </section>
      <section className={ui.panel}><p className={ui.eyebrow}>Vocabulary practice</p><h2>词汇复习状态与原始作答</h2>
        <div className={styles.vocabularyStats}>{[["进入较长复习间隔", data.vocabulary.known], ["Learning · 学习中", data.vocabulary.learning], ["New · 尚未开始学习", data.vocabulary.new], ["Due · 当前到期", data.vocabulary.due]].map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
        <p>较长间隔指已开始学习且当前复习间隔 ≥ 21 天，不代表四种模式都已掌握。已学后遗忘的词仍属学习中；到期数包含新词。</p>
        <p><strong>复习自评记得比例 {percent(data.vocabulary.retention)}</strong> · {data.vocabulary.reviews} 次记录中自评非 Again 的比例，旧记录采用原评分。答题型原始准确率 {percent(data.vocabulary.objectiveAccuracy)}（{data.vocabulary.objectiveSampleCount} 个有效样本）。</p>
        <div className={styles.tableWrap}><table className={ui.table}><thead><tr><th>复习模式</th><th>原始正确 / 样本数</th><th>原始准确率</th><th>确认笔误</th></tr></thead><tbody>{data.vocabulary.byMode.map((row) => <tr key={row.mode}><td>{{ recognition: "认识词义 · 自评", recall: "释义回忆", spelling: "听音拼写", context: "语境填空" }[row.mode]}<br /><small>{row.reviewCount} 次复习</small></td><td>{row.mode === "recognition" ? "仅自评" : `${row.correctCount}/${row.sampleCount}`}</td><td>{percent(row.rawAccuracy)}</td><td>{row.confirmedTypoCount}</td></tr>)}</tbody></table></div>
        <p>确认笔误 {data.vocabulary.confirmedTypoCount} 次；原始拼写错误仍计入错误，不提高准确率。认识词义没有客观正确率。{data.vocabulary.legacyAuditUnknownCount > 0 ? `另有 ${data.vocabulary.legacyAuditUnknownCount} 次旧记录缺少评分审计，未知笔误不推算。` : ""}</p>
        <h3 className={styles.subheading}>近 7 天复习量</h3><Distribution rows={data.vocabulary.reviewsByDay.map((day) => ({ label: day.date.slice(5), count: day.count }))} empty="暂无复习记录。" />
      </section>
    </div>
    <section className={`${ui.panel} ${styles.section}`}><p className={ui.eyebrow}>Academic writing</p><h2>AI Estimated Band · 写作变化</h2><p>{data.writingDrafts} 个本地版本 · {data.writing.length} 次有 AI 来源的完整评估。{grammar !== null ? `GRA 平均 ${grammar.toFixed(1)}。` : "尚无 AI 评估。"}训练估分，不是官方成绩；Task 1 / Task 2 应分别比较。</p>
      {recentWriting.length ? <div className={styles.tableWrap}><table className={ui.table}><thead><tr><th>时间</th><th>任务</th><th>AI Estimated Band</th><th>TA / TR</th><th>CC</th><th>LR</th><th>GRA</th><th>字数</th></tr></thead><tbody>{recentWriting.map((item) => <tr key={item.id}><td>{date(item.submittedAt)}</td><td>{item.taskType.toUpperCase()}</td><td><strong>{item.overallBand.toFixed(1)}</strong></td><td>{item.criteria.taskResponse.toFixed(1)}</td><td>{item.criteria.coherenceCohesion.toFixed(1)}</td><td>{item.criteria.lexicalResource.toFixed(1)}</td><td>{item.criteria.grammarAccuracy.toFixed(1)}</td><td>{item.wordCount}</td></tr>)}</tbody></table></div> : <div className={ui.empty}>无 AI 时仍可保存作文、改写和对比版本。配置 AI 后，真实反馈会形成这里的时间序列。</div>}
      <h3 className={styles.subheading}>最常出现的写作错误</h3><Distribution rows={data.writingErrors} empty="结构化写作反馈中的语法与用词错误会自动进入 Mistakes，并按类别汇总。" />
    </section>
    <section className={`${ui.panel} ${styles.section}`}><p className={ui.eyebrow}>Study rhythm</p><h2>近 14 天学习分钟数</h2><p>仅累计页面前台活跃时长；离开页面、隐藏窗口或长时间无操作不会持续计时。</p>
      <div className={styles.days}>{data.study.minutesByDay.map((day) => <div key={day.date}><span>{day.minutes.toFixed(1)}</span><div className={styles.dayTrack}><i style={{ height: `${day.minutes / maxMinutes * 100}%` }} /></div><small>{day.date.slice(5)}</small></div>)}</div>
    </section>
    <div className={`${ui.grid2} ${styles.section}`}>
      <section className={ui.panel}><h2>最近 Reading / Listening</h2>{data.attempts.length ? <div className={styles.tableWrap}><table className={ui.table}><thead><tr><th>练习</th><th>正确 / 题数</th><th>时长</th><th>时间</th></tr></thead><tbody>{data.attempts.map((attempt) => <tr key={attempt.id}><td>{attempt.kind}<br />{attempt.title}</td><td>{attempt.correct}/{attempt.total}</td><td>{(attempt.seconds / 60).toFixed(1)} min</td><td>{date(attempt.submittedAt)}</td></tr>)}</tbody></table></div> : <div className={ui.empty}>完成首组练习后，实际结果会出现在这里。</div>}</section>
      <section className={ui.panel}><h2>最近学习活动</h2>{data.activity.length ? <div className={ui.list}>{data.activity.map((item, index) => <Link href={item.href} className={`${ui.listItem} ${styles.activity}`} key={`${item.date}-${index}`}><strong>{item.label}</strong><small>{item.detail} · {date(item.date)}</small></Link>)}</div> : <div className={ui.empty}>尚无完成的练习。先从 Today 选择一个学习任务。</div>}</section>
    </div>
  </div>;
}
