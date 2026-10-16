'use client';

import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useEffect, useRef, useState} from 'react';
import {BookOpen, CalendarDays, ChartNoAxesCombined, ChevronRight, CircleCheck, FolderOpen, Headphones, Languages, Menu, MessageCircle, Moon, NotebookPen, Settings, ShieldCheck, Sun, Timer, X} from 'lucide-react';
import {product} from '@/lib/product';
import {VocabularyCapture} from './vocabulary-capture';
import {StudyHeartbeat} from './study-heartbeat';
import styles from './app-shell.module.css';

const groups = [
  {label:'每日学习',items:[
    {href:'/',name:'今日学习',english:'Today',icon:CalendarDays},
    {href:'/practice/reading',name:'阅读练习',english:'Reading',icon:BookOpen},
    {href:'/practice/listening',name:'听力练习',english:'Listening',icon:Headphones},
    {href:'/vocabulary',name:'词汇学习',english:'Vocabulary',icon:Languages},
    {href:'/writing',name:'写作练习',english:'Writing',icon:NotebookPen},
  ]},
  {label:'复盘与资料',items:[
    {href:'/review',name:'错题复习',english:'Review',icon:CircleCheck},
    {href:'/materials',name:'学习材料',english:'Materials',icon:FolderOpen},
    {href:'/analytics',name:'学习分析',english:'Analytics',icon:ChartNoAxesCombined},
  ]},
  {label:'学习工具',items:[
    {href:'/coach',name:'AI 助教',english:'Tutor',icon:MessageCircle},
    {href:'/mock-exam',name:'模拟考试',english:'Mock exam',icon:Timer},
    {href:'/settings',name:'设置',english:'Settings',icon:Settings},
  ]},
];

export function AppShell({children,theme:initial}:{children:React.ReactNode,theme:'light'|'dark'}) {
  const pathname = usePathname();
  const [theme,setTheme] = useState(initial);
  const dialog = useRef<HTMLDialogElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const active = groups.flatMap(group=>group.items).find(item=>pathname===item.href || (item.href!=='/' && pathname.startsWith(item.href+'/')));
  const title = active?.name ?? (pathname.startsWith('/practice/set/') ? '答题工作台' : '学习工作台');

  useEffect(()=>{
    const media = window.matchMedia('(min-width: 761px)');
    const closeOnDesktop = ()=>{ if (media.matches) dialog.current?.close(); };
    media.addEventListener('change',closeOnDesktop);
    return ()=>media.removeEventListener('change',closeOnDesktop);
  },[]);

  async function toggleTheme() {
    const next = theme==='light'?'dark':'light';
    setTheme(next);
    document.documentElement.dataset.theme=next;
    try {
      const r=await fetch('/api/settings');
      const p=await r.json();
      await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...p.preferences,theme:next})});
    } catch { /* Theme remains usable while offline. */ }
  }

  function navigation(closeOnNavigate=false) {
    return <>
      <Link className={styles.brand} href="/" onClick={()=>{if(closeOnNavigate) dialog.current?.close();}}>
        <span className={styles.brandMark}>i.</span><span><strong>{product.name}</strong><small>你的雅思学习工作台</small></span>
      </Link>
      <nav className={styles.nav} aria-label={closeOnNavigate?'移动主要导航':'主要导航'}>
        {groups.map(group=><div className={styles.navSection} key={group.label}>
          <p>{group.label}</p>{group.items.map(({href,name,english,icon:Icon})=>{
            const current=pathname===href || (href!=='/' && pathname.startsWith(href+'/'));
            return <Link className={`${styles.navItem} ${current?styles.current:''}`} href={href} key={href} aria-current={current?'page':undefined} onClick={()=>{if(closeOnNavigate) dialog.current?.close();}}>
              <Icon size={19} strokeWidth={1.7} aria-hidden="true"/>
              <span className={styles.navLabel}><strong>{name}</strong><small>{english}</small></span>
              {current && <ChevronRight size={15} className={styles.currentArrow} aria-hidden="true"/>}
            </Link>;
          })}
        </div>)}
      </nav>
      <div className={styles.footer}>
        <button type="button" className={styles.themeButton} onClick={()=>void toggleTheme()}>
          {theme==='light'?<Moon size={18} aria-hidden="true"/>:<Sun size={18} aria-hidden="true"/>}
          {theme==='light'?'切换深色外观':'切换浅色外观'}
        </button>
        <div className={styles.localBadge}><ShieldCheck size={18} aria-hidden="true"/><span><strong>本地工作台</strong><small>材料与学习记录保存在本地</small></span></div>
      </div>
    </>;
  }

  return <div className={styles.shell}>
    <a href="#main-content" className="skip-link">跳至主要内容</a>
    <aside className={styles.sidebar}>{navigation()}</aside>
    <header className={styles.mobileHeader}>
      <button ref={menuButton} className={styles.iconButton} type="button" aria-label="打开导航菜单" aria-haspopup="dialog" aria-controls="mobile-navigation" onClick={()=>dialog.current?.showModal()}><Menu size={22} aria-hidden="true"/></button>
      <span>{title}</span><span className={styles.mobileBrand}>IELTS Studio</span>
    </header>
    <dialog id="mobile-navigation" ref={dialog} className={styles.drawer} aria-label="工作台导航" onClose={()=>{if(menuButton.current?.getClientRects().length) menuButton.current.focus();}} onKeyDown={event=>{
      if(event.key!=='Tab') return;
      const controls=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')).filter(element=>element.getClientRects().length);
      const first=controls[0],last=controls.at(-1);
      if(event.shiftKey && document.activeElement===first) { event.preventDefault(); last?.focus(); }
      else if(!event.shiftKey && document.activeElement===last) { event.preventDefault(); first?.focus(); }
    }} onClick={event=>{
      if(event.target!==event.currentTarget) return;
      const rect=event.currentTarget.getBoundingClientRect();
      if(event.clientX<rect.left || event.clientX>rect.right || event.clientY<rect.top || event.clientY>rect.bottom) event.currentTarget.close();
    }}>
      <button autoFocus className={`${styles.iconButton} ${styles.closeMenu}`} type="button" aria-label="关闭导航菜单" onClick={()=>dialog.current?.close()}><X size={22} aria-hidden="true"/></button>
      {navigation(true)}
    </dialog>
    <main className={styles.main} id="main-content" tabIndex={-1}>{children}</main>
    <VocabularyCapture/><StudyHeartbeat/>
  </div>;
}
