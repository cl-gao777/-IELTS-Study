import 'server-only';
import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { databasePath } from './db';

export const aiSettingsSchema=z.object({baseUrl:z.string().url(),apiKey:z.string().max(4000),model:z.string().trim().min(1).max(150),wireApi:z.enum(['responses','chat-completions'])});
export type AiSettings=z.infer<typeof aiSettingsSchema>;
// Credentials live beside the runtime database, never inside traced build assets.
function location(){ return path.join(/* turbopackIgnore: true */ path.dirname(databasePath()),'ai-provider.secret.json'); }
export function readAiSettings():AiSettings|null {
  try {const file=location(); return existsSync(/* turbopackIgnore: true */ file)?aiSettingsSchema.parse(JSON.parse(readFileSync(/* turbopackIgnore: true */ file,'utf8'))):null;} catch{return null;}
}
export function saveAiSettings(input:AiSettings){
  const old=readAiSettings();
  const value=aiSettingsSchema.parse({...input,apiKey:input.apiKey || old?.apiKey || ''});
  if(!value.apiKey) throw new Error('请输入 API Key。');
  if(!/^https:\/\//i.test(value.baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(value.baseUrl)) throw new Error('远程 AI 地址必须使用 HTTPS；本机服务可使用 HTTP。');
  const file=location(); mkdirSync(/* turbopackIgnore: true */ path.dirname(file),{recursive:true});writeFileSync(/* turbopackIgnore: true */ file+'.tmp',JSON.stringify(value),{mode:0o600});renameSync(/* turbopackIgnore: true */ file+'.tmp',file);
}
export function aiSettingsSummary(){const a=readAiSettings();return a?{baseUrl:a.baseUrl,model:a.model,wireApi:a.wireApi,hasKey:Boolean(a.apiKey)}:null;}
