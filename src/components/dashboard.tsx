'use client';

import Link from 'next/link';
import {useState} from 'react';
import {ArrowRight, ArrowUpRight, Check, Clock3, FolderOpen, SlidersHorizontal} from 'lucide-react';
import type {DashboardSnapshot,StudyTask} from '@/lib/domain';
import {calculateStudyProgress} from '@/lib/study-progress';
import ui from './page-ui.module.css';
import styles from './dashboard.module.css';

export function Dashboard({initial}:{initial:DashboardSnapshot}) {
  const [tasks,setTasks]=useState(initial.tasks);
  const [busy,setBusy]=useState('');
  const [error,setError]=useState('');
  const progress=calculateStudyProgress(tasks);
  const next=tasks.find(task=>!task.completed);
  async function toggle(task:StudyTask) {
    setBusy(task.id);
    try {
      const response=await fetch(`/api/tasks/${task.id}`,{method:'POST'});
      if(!response.ok) throw new Error();
      const payload=await response.json();
      setTasks(current=>current.map(item=>item.id===task.id?payload.task:item));
    } catch { setError('保存失败，请重试。'); } finally { setBusy(''); }
  }
  const accuracy=(kind:string)=>{
    const attempts=initial.recentAttempts.filter(attempt=>attempt.kind===kind);
    const total=attempts.reduce((sum,item)=>sum+item.totalQuestions,0);
    return total?`${Math.round(attempts.reduce((sum,item)=>sum+item.rawScore,0)/total*100)}%`:'—';
  };
  return <div className={ui.page}>
    <header className={ui.pageHeader}>
      <div><p className={ui.eyebrow}>{initial.date} / YOUR STUDY DESK</p><h1>今天，继续向前一步。</h1><p>{initial.displayName}，专注下一项练习。目标 Overall {initial.targetBand.toFixed(1)}+。</p></div>
      <Link href="/settings" className={ui.buttonSecondary}><SlidersHorizontal size={16} aria-hidden="true"/>学习计划</Link>
    </header>
    {error && <p role="alert" className={ui.error}>{error}</p>}
    <section className={styles.overview} aria-label="今日学习重点">
      <div className={styles.focus}><p className={styles.focusLabel}><span/>今日重点 <small>TODAY’S FOCUS</small></p><h2>{next?next.title:'今日计划已完成'}</h2><p>{next?next.detail:'回看一个错题，把今天的发现留到明天。'}</p><Link className={ui.button} href={next?.href||'/review'}>{next?'继续学习':'复盘今日错题'}<ArrowRight size={18} aria-hidden="true"/></Link></div>
      <div className={styles.progress}><span>{progress.percentage}<small>%</small></span><p>{tasks.filter(task=>task.completed).length} / {tasks.length} 项已完成</p><progress max={100} value={progress.percentage} aria-label="今日任务完成进度"/><small><Clock3 size={14} aria-hidden="true"/>今日计划 {progress.totalMinutes} 分钟</small></div>
    </section>
    <section className={styles.metrics} aria-label="学习概况">
      <div><small>今日实际学习</small><strong>{initial.todayMinutes}<i>分钟</i></strong></div><div><small>连续学习</small><strong>{initial.streak}<i>天</i></strong></div><div><small>到期词汇</small><strong>{initial.dueVocabulary}<i>个</i></strong></div><div><small>待复习错题</small><strong>{initial.reviewCount}<i>题</i></strong></div>
    </section>
    <div className={styles.content}>
      <section className={styles.schedule}>
        <div className={ui.panelHeader}><div><p className={ui.eyebrow}>YOUR DAILY LOOP</p><h2>今日学习安排</h2></div><span className={ui.pill}>{initial.dailyMinutes} 分钟 / 天</span></div>
        <div className={styles.tasks}>{tasks.map((task,index)=><div className={styles.task} data-done={task.completed} key={task.id}>
          <button type="button" className={styles.check} disabled={busy===task.id} onClick={()=>void toggle(task)} aria-pressed={task.completed} aria-label={`${task.completed?'撤销':'完成'} ${task.area}`}>{task.completed?<Check size={18} aria-hidden="true"/>:String(index+1).padStart(2,'0')}</button>
          <Link href={task.href}><small>{task.area}</small><strong>{task.title}</strong><span>{task.detail}</span></Link><small>{task.estimatedMinutes} 分钟</small><Link className={styles.taskOpen} href={task.href} aria-label={`开始 ${task.area}`}><ArrowUpRight size={18} aria-hidden="true"/></Link>
        </div>)}</div>
        <p className={styles.note}>勾选表示任务完成；实际学习时间按活动页面记录。</p>
      </section>
      <aside className={styles.insights}>
        <p className={ui.eyebrow}>RECENT SIGNALS</p><h2>近期练习表现</h2>
        <div className={styles.signal}><span>阅读正确率</span><b>{accuracy('reading')}</b></div><div className={styles.signal}><span>听力正确率</span><b>{accuracy('listening')}</b></div><div className={styles.signal}><span>写作 · AI 估分</span><b>{initial.estimatedBands.writing||'—'}</b></div>
        <p className={styles.note}>暂无记录时显示 —；短练习不推断正式 IELTS 总分。</p><Link className={styles.textLink} href="/analytics">查看学习分析<ArrowRight size={16} aria-hidden="true"/></Link>
        <div className={styles.materials}><FolderOpen size={22} aria-hidden="true"/><div><h3>从你的材料开始</h3><p>把文章、音频和笔记带入下一次学习。</p><Link className={styles.textLink} href="/materials">导入学习材料<ArrowRight size={16} aria-hidden="true"/></Link></div></div>
        <details className={styles.baseline}><summary>还没有能力基线？</summary><p>用实际阅读、听力和写作建立基线，完成三项后查看建议。</p><Link className={styles.textLink} href="/practice">开始原创样题<ArrowRight size={16} aria-hidden="true"/></Link></details>
      </aside>
    </div>
  </div>;
}
