import 'server-only';
import {getDatabase} from './db';
export function retrieveTutorContext(message:string){
 const db=getDatabase();const words=message.match(/[A-Za-z]{4,}/g)?.slice(0,5)||[];const query=words[0]||message.slice(0,30);
 const materials=db.prepare('SELECT id,title,substr(content,1,4000) AS excerpt FROM source_materials WHERE title LIKE ? OR content LIKE ? ORDER BY id DESC LIMIT 2').all('%'+query+'%','%'+query+'%');
 const vocabulary=db.prepare('SELECT term,meaning_zh,example FROM vocabulary_words WHERE term LIKE ? OR meaning_zh LIKE ? ORDER BY updated_at DESC LIMIT 8').all('%'+query+'%','%'+query+'%');
 const mistakes=db.prepare('SELECT skill,prompt,answer,category FROM review_items WHERE resolved=0 ORDER BY id DESC LIMIT 6').all();
 const history=db.prepare('SELECT kind,raw_score,total_questions,duration_seconds,submitted_at FROM practice_attempts ORDER BY id DESC LIMIT 5').all();
 return JSON.stringify({materials,vocabulary,mistakes,history}).slice(0,14000);
}
