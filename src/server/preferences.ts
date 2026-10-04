import 'server-only';
import { z } from 'zod';
import { getDatabase } from './db';

export const preferencesSchema = z.object({
  displayName: z.string().trim().min(1).max(60).default('学习者'),
  dailyMinutes: z.number().int().min(15).max(360).default(60),
  targetBand: z.number().min(0).max(9).default(6.5),
  minimumBand: z.number().min(0).max(9).default(5.5),
  theme: z.enum(['light', 'dark']).default('light'),
  useCodexFallback: z.boolean().default(false),
});
export type Preferences = z.infer<typeof preferencesSchema>;
export function getPreferences(): Preferences {
  const row = getDatabase().prepare('SELECT value_json FROM studio_preferences WHERE id=1').get() as {value_json: string} | undefined;
  return preferencesSchema.parse(row ? JSON.parse(row.value_json) : {});
}
export function savePreferences(input: Preferences) {
  const value = preferencesSchema.parse(input);
  const db = getDatabase();
  db.transaction(() => {
    db.prepare('INSERT INTO studio_preferences (id,value_json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json').run(JSON.stringify(value));
    db.prepare('UPDATE settings SET display_name=?,daily_minutes=?,target_band=?,updated_at=? WHERE id=1').run(value.displayName,value.dailyMinutes,value.targetBand,new Date().toISOString());
    const total = value.dailyMinutes;
    const portions = [Math.floor(total*.2),Math.floor(total*.25),Math.floor(total*.3)];
    portions.push(total - portions.reduce((a,b)=>a+b,0));
    for (const [i,area] of ['Vocabulary','Listening','Reading','Writing'].entries()) {
      db.prepare('UPDATE study_tasks SET estimated_minutes=? WHERE study_date=? AND area=?').run(portions[i],studyDate(),area);
    }
  })();
  return value;
}
export function studyDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:process.env.APP_TIME_ZONE || 'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
}
export function recordStudySession(id:string, area:string, seconds:number) {
  const db=getDatabase();
  const date=studyDate();
  // One shared heartbeat per browser, wall-clock bounded; duplicate beacons are idempotent.
  const key=`${id}:${date}:${area}`;
  const previous=db.prepare('SELECT updated_at FROM study_sessions WHERE id=?').get(key) as {updated_at:string}|undefined;
  const now=new Date();
  const elapsed=previous ? Math.max(0,Math.floor((now.getTime()-new Date(previous.updated_at).getTime())/1000)) : 15;
  const credited=Math.min(15, seconds, elapsed);
  db.prepare(`INSERT INTO study_sessions(id,study_date,area,duration_seconds,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET duration_seconds=duration_seconds+excluded.duration_seconds,updated_at=excluded.updated_at`).run(key,date,area,credited,now.toISOString());
}
