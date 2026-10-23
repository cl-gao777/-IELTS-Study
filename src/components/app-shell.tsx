'use client';

import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {useEffect, useRef, useState} from 'react';
import {BookOpen, CalendarDays, ChartNoAxesCombined, ChevronDown, ChevronRight, CircleCheck, FolderOpen, GitBranch, Headphones, Languages, Menu, MessageCircle, Moon, NotebookPen, Settings, Sun, Timer, X} from 'lucide-react';
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
    {href:'/morphology',name:'词根词缀',english:'Word formation',icon:GitBranch},
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
  const more = useRef<HTMLDetailsElement>(null);
  const active = groups.flatMap(group=>group.items).find(item=>pathname===item.href || (item.href!=='/' && pathname.startsWith(item.href+'/')));
  const title = active?.name ?? (pathname.startsWith('/practice/set/') ? '答题工作台' : '学习工作台');

  useEffect(()=>{
    const media = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = ()=>{ if (media.matches) dialog.current?.close(); else if(more.current) more.current.open=false; };
    const closeOutside = (event:PointerEvent)=>{ if(more.current && !more.current.contains(event.target as Node)) more.current.open=false; };
    const closeEscape = (event:KeyboardEvent)=>{ if(event.key==='Escape' && more.current?.open) { more.current.open=false; more.current.querySelector('summary')?.focus(); event.preventDefault(); } };
    media.addEventListener('change',closeOnDesktop);
    document.addEventListener('pointerdown',closeOutside);
    document.addEventListener('keydown',closeEscape);
    return ()=>{media.removeEventListener('change',closeOnDesktop);document.removeEventListener('pointerdown',closeOutside);document.removeEventListener('keydown',closeEscape);};
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

  function closeNavigation(){ dialog.current?.close(); if(more.current) more.current.open=false; }
  function brand() { return <Link className={styles.brand} href="/" onClick={closeNavigation}><span className={styles.brandMark}>i.</span><strong>{product.name}</strong></Link>; }
  function themeButton() { return <button type="button" className={styles.themeButton} onClick={()=>void toggleTheme()} aria-label={theme==='light'?'切换深色外观':'切换浅色外观'} title={theme==='light'?'切换深色外观':'切换浅色外观'}>{theme==='light'?<Moon size={18} aria-hidden="true"/>:<Sun size={18} aria-hidden="true"/>}</button>; }
  function navigation() {
    return <>
      {brand()}
      <nav className={styles.nav} aria-label="移动主要导航">
        {groups.map(group=><div className={styles.navSection} key={group.label}>
          <p>{group.label}</p>{group.items.map(({href,name,english,icon:Icon})=>{
            const current=pathname===href || (href!=='/' && pathname.startsWith(href+'/'));
            return <Link className={`${styles.navItem} ${current?styles.current:''}`} href={href} key={href} aria-label={`${name} ${english}`} aria-current={current?'page':undefined} onClick={closeNavigation}>
              <Icon size={19} strokeWidth={1.7} aria-hidden="true"/>
              <span className={styles.navLabel}><strong>{name}</strong><small>{english}</small></span>
              {current && <ChevronRight size={15} className={styles.currentArrow} aria-hidden="true"/>}
            </Link>;
          })}
        </div>)}
      </nav>
      <p className={styles.localBadge}>本地工作台 · 资料与记录保存在本地</p>
    </>;
  }

  return <div className={styles.shell}>
    <a href="#main-content" className="skip-link">跳至主要内容</a>
    <header className={styles.header}>
      <div className={styles.headerInner}>
      <button ref={menuButton} className={`${styles.iconButton} ${styles.menuButton}`} type="button" aria-label="打开导航菜单" aria-haspopup="dialog" aria-controls="mobile-navigation" onClick={()=>dialog.current?.showModal()}><Menu size={22} aria-hidden="true"/></button>
      <div className={styles.desktopBrand}>{brand()}</div><span className={styles.mobileTitle}>{title}</span>
      <nav className={styles.topNav} aria-label="主要导航">{groups[0].items.map((item,index)=><Link key={item.href} href={item.href} className={`${styles.topLink} ${active?.href===item.href?styles.current:''}`} aria-label={`${item.name} ${item.english}`} aria-current={active?.href===item.href?'page':undefined} onClick={closeNavigation}>{['今日','阅读','听力','词汇','词根','写作'][index]}</Link>)}
        <details ref={more} className={styles.more} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))event.currentTarget.open=false;}} onKeyDown={event=>{
          if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
          event.preventDefault();const el=event.currentTarget;el.open=true;
          requestAnimationFrame(()=>{const links=Array.from(el.querySelectorAll<HTMLAnchorElement>('a[href]'));const at=links.indexOf(document.activeElement as HTMLAnchorElement);const index=event.key==='Home'?0:event.key==='End'?links.length-1:event.key==='ArrowDown'?(at+1)%links.length:(at<0?links.length-1:(at-1+links.length)%links.length);links[index]?.focus();});
        }}><summary className={`${styles.topLink} ${active && !groups[0].items.some(item=>item.href===active.href)?styles.current:''}`}>更多<ChevronDown size={14} aria-hidden="true"/></summary><nav className={styles.morePanel} aria-label="更多页面">{groups.slice(1).map(group=><div key={group.label}><p>{group.label}</p>{group.items.map(({href,name,icon:Icon})=><Link key={href} href={href} className={`${styles.navItem} ${active?.href===href?styles.current:''}`} aria-current={active?.href===href?'page':undefined} onClick={closeNavigation}><Icon size={17} aria-hidden="true"/>{name}</Link>)}</div>)}</nav></details>
      </nav><div className={styles.headerEnd}>{themeButton()}</div>
      </div>
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
      {navigation()}
    </dialog>
    <main className={styles.main} id="main-content" tabIndex={-1}>{children}</main>
    <VocabularyCapture/><StudyHeartbeat/>
  </div>;
}
