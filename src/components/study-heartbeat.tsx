'use client';
import {useEffect} from 'react';
import {usePathname} from 'next/navigation';
export function StudyHeartbeat(){
 const pathname=usePathname();
 useEffect(()=>{
   // Vocabulary owns a persistent pause control and idempotent foreground timer.
   if(pathname.startsWith('/vocabulary'))return;
   const area=document.querySelector('[data-study-area]')?.getAttribute('data-study-area') || (pathname.includes('reading')?'Reading':pathname.includes('listening')?'Listening':pathname.startsWith('/vocabulary')?'Vocabulary':pathname.startsWith('/writing')?'Writing':null);
   if(!area)return;
   const id=crypto.randomUUID();let active=Date.now();let last=Date.now();
   const touch=()=>{active=Date.now();};
   window.addEventListener('keydown',touch);window.addEventListener('pointerdown',touch);window.addEventListener('scroll',touch,true);
   const timer=window.setInterval(async()=>{
     const audioPlaying=Array.from(document.querySelectorAll('audio')).some(audio=>!audio.paused && !audio.ended && audio.readyState>=2);
     const speechPlaying=Boolean(window.speechSynthesis?.speaking && !window.speechSynthesis.paused);
     if(document.hidden || !document.hasFocus() || (Date.now()-active>180000 && !audioPlaying && !speechPlaying)) {last=Date.now();return;}
     // Web Locks prevents multiple open Studio tabs from counting the same time.
     const send=async()=>{const seconds=Math.min(15,Math.floor((Date.now()-last)/1000));last=Date.now();await fetch('/api/study',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,area,seconds})}).catch(()=>{});};
     if(navigator.locks) await navigator.locks.request('ielts-study-heartbeat',{ifAvailable:true},async lock=>{if(lock)await send();});else await send();
   },15000);
   return()=>{window.clearInterval(timer);window.removeEventListener('keydown',touch);window.removeEventListener('pointerdown',touch);window.removeEventListener('scroll',touch,true);};
 },[pathname]);
 return null;
}
