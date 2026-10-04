'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useState} from 'react';
import {product} from '@/lib/product';
import {VocabularyCapture} from './vocabulary-capture';
import {StudyHeartbeat} from './study-heartbeat';
import styles from './app-shell.module.css';
const groups=[{label:'每日学习',items:[['/','Today · 今日','⌂'],['/practice/reading','Reading · 阅读','▤'],['/practice/listening','Listening · 听力','◉'],['/vocabulary','Vocabulary · 词汇','Aa'],['/writing','Writing · 写作','✎']]},{label:'复盘与资料',items:[['/review','Mistakes · 错题','↺'],['/materials','Materials · 材料','▥'],['/analytics','Analytics · 分析','↗']]},{label:'工具',items:[['/coach','AI Tutor · 助教','✧'],['/mock-exam','Mock · 模拟练习','◫'],['/settings','Settings · 设置','⚙']]}];
export function AppShell({children,theme:initial}:{children:React.ReactNode,theme:'light'|'dark'}){
 const pathname=usePathname();const [theme,setTheme]=useState(initial);
 async function toggleTheme(){const next=theme==='light'?'dark':'light';setTheme(next);document.documentElement.dataset.theme=next;try{const r=await fetch('/api/settings');const p=await r.json();await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...p.preferences,theme:next})});}catch{}}
 return <div className={styles.shell}><a href="#main-content" className="skip-link">跳至主要内容</a><aside className={styles.sidebar}><Link className={styles.brand} href="/"><span className={styles.brandMark}>i.</span><span><strong>{product.name}</strong><small>PERSONAL LEARNING OS</small></span></Link><nav className={styles.nav} aria-label="主要导航">{groups.map(g=><div className={styles.navSection} key={g.label}><p>{g.label}</p>{g.items.map(([href,label,icon])=>{const current=pathname===href||(href!=='/'&&pathname.startsWith(href+'/'));return <Link className={`${styles.navItem} ${current?styles.current:''}`} href={href} key={href} aria-current={current?'page':undefined}><span>{icon}</span>{label}</Link>})}</div>)}</nav><div className={styles.footer}><button type="button" className={styles.themeButton} onClick={toggleTheme}>{theme==='light'?'☾ 深色外观':'☀ 浅色外观'}</button><div className={styles.localBadge}><i/><span><strong>本地工作台</strong><small>你的材料，你的学习记录</small></span></div></div></aside><main className={styles.main} id="main-content">{children}</main><VocabularyCapture/><StudyHeartbeat/></div>;
}
