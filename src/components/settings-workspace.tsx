'use client';
import {FormEvent,useState} from 'react';
import {notifyBackupRestored} from '@/lib/backup-recovery';
import ui from './page-ui.module.css';
import type {Preferences} from '@/server/preferences';
type AiSummary={baseUrl:string,model:string,wireApi:string,hasKey:boolean}|null;
export function SettingsWorkspace({initial,ai,databasePath}:{initial:Preferences,ai:AiSummary,databasePath:string}){
 const [preferences,setPreferences]=useState(initial);const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);
 async function save(event:FormEvent<HTMLFormElement>,kind:'study'|'ai'){
  event.preventDefault();const data=new FormData(event.currentTarget);setBusy(true);setMessage('');
  try{const body=kind==='study'?{...preferences,displayName:String(data.get('displayName')),dailyMinutes:Number(data.get('dailyMinutes')),targetBand:Number(data.get('targetBand')),minimumBand:Number(data.get('minimumBand')),useCodexFallback:data.get('useCodexFallback')==='on'}:{ai:{baseUrl:String(data.get('baseUrl')),apiKey:String(data.get('apiKey')),model:String(data.get('model')),wireApi:String(data.get('wireApi'))}};
   const r=await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const p=await r.json();if(!r.ok)throw new Error(p.error);if(p.preferences)setPreferences(p.preferences);setMessage('设置已保存。');
  }catch(e){setMessage(e instanceof Error?e.message:'保存失败');}finally{setBusy(false);}
 }
 async function restore(event:FormEvent<HTMLFormElement>){event.preventDefault();const d=new FormData(event.currentTarget);const file=d.get('backup') as File;if(!file?.size)return;setBusy(true);try{const backup=JSON.parse(await file.text());const r=await fetch('/api/backup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({backup,confirm:d.get('confirm')})});const p=await r.json();if(!r.ok)throw new Error(p.error);setMessage('恢复成功。旧数据快照保存在 '+p.safetyBackup+(p.warning?'。'+p.warning:''));notifyBackupRestored();window.setTimeout(()=>window.location.reload(),1800);}catch(e){setMessage(e instanceof Error?e.message:'恢复失败');}finally{setBusy(false);}}
 return <div className={ui.page}><header className={ui.pageHeader}><div><p className={ui.eyebrow}>YOUR WORKSPACE</p><h1>设置与数据备份</h1><p>学习节奏由你决定。数据保存在本机，可随时完整带走。</p></div></header>
 {message&&<p role="status" className={ui.notice}>{message}</p>}
 <div className={ui.grid2}><div className={ui.stack}>
 <form className={`${ui.panel} ${ui.formGrid}`} onSubmit={e=>save(e,'study')}><h2>每日学习计划</h2>
 <label className={ui.field}>称呼<input className={ui.input} name="displayName" defaultValue={preferences.displayName} required/></label>
 <label className={ui.field}>每天学习分钟数<input className={ui.input} type="number" name="dailyMinutes" min="15" max="360" defaultValue={preferences.dailyMinutes} required/></label>
 <div className={ui.formGrid2}><label className={ui.field}>Overall 目标<input className={ui.input} type="number" step="0.5" name="targetBand" min="0" max="9" defaultValue={preferences.targetBand}/></label><label className={ui.field}>单项目标下限<input className={ui.input} type="number" step="0.5" name="minimumBand" min="0" max="9" defaultValue={preferences.minimumBand}/></label></div>
 <label><input name="useCodexFallback" type="checkbox" defaultChecked={preferences.useCodexFallback}/> 使用本机 Codex 配置作为 AI 备用连接</label>
 <button className={ui.button} disabled={busy}>保存学习设置</button></form>
 <form className={`${ui.panel} ${ui.formGrid}`} onSubmit={e=>save(e,'ai')}><h2>AI Provider · 可选</h2><p>仅在你请求 AI 功能时发送相关材料。密钥仅存服务端私有配置文件，不进入学习备份。</p>
 <label className={ui.field}>Base URL<input className={ui.input} name="baseUrl" type="url" defaultValue={ai?.baseUrl||'https://api.openai.com/v1'} required/></label>
 <label className={ui.field}>API Key {ai?.hasKey?'· 已配置，留空保留':''}<input className={ui.input} name="apiKey" type="password" autoComplete="new-password"/></label>
 <label className={ui.field}>Model<input className={ui.input} name="model" defaultValue={ai?.model||''} placeholder="填写提供商的模型名称" required/></label>
 <label className={ui.field}>API protocol<select className={ui.select} name="wireApi" defaultValue={ai?.wireApi||'responses'}><option value="responses">OpenAI Responses API</option><option value="chat-completions">Chat Completions compatible</option></select></label>
 <button className={ui.button} disabled={busy}>保存 AI 配置</button></form></div>
 <div className={ui.stack}><section className={ui.panel}><p className={ui.eyebrow}>DATA OWNERSHIP</p><h2>完整 JSON 备份</h2><p>包含词汇、词根课程与学习记录、复习、练习、作文版本、错题和全部上传文件。恢复时先保存当前数据快照，再执行事务恢复。</p><a className={ui.button} href="/api/backup">导出完整 JSON Backup</a><p><a href="/api/backup?format=sqlite">下载 SQLite 数据库快照</a>（不包含独立上传文件）</p><p>数据库位置</p><code style={{overflowWrap:'anywhere'}}>{databasePath}</code></section>
 <form className={`${ui.panel} ${ui.formGrid}`} onSubmit={restore}><h2>从 JSON Backup 恢复</h2><p>恢复将替换当前学习记录。操作前会自动备份当前数据。</p><label className={ui.field}>备份文件<input className={ui.input} name="backup" type="file" accept=".json" required/></label><label className={ui.field}>输入 RESTORE 确认替换<input className={ui.input} name="confirm" pattern="RESTORE" placeholder="RESTORE" required/></label><button className={ui.dangerButton} disabled={busy}>{busy?'处理中…':'恢复备份'}</button></form>
 <section className={ui.panel}><h2>本地优先</h2><p>没有 AI Key 时，阅读、精听、FSRS、写作草稿、错题、统计及备份均可使用。无需登录或云数据库。</p><p>升级前导出完整备份。更新代码、安装依赖和构建不会清空数据。</p></section></div></div></div>;
}
