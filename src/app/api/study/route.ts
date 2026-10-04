import {z} from 'zod';
import {recordStudySession} from '@/server/preferences';
const schema=z.object({id:z.string().uuid(),area:z.enum(['Reading','Listening','Vocabulary','Writing']),seconds:z.number().int().min(0).max(15)});
export async function POST(request:Request){try{const x=schema.parse(await request.json());recordStudySession(x.id,x.area,x.seconds);return Response.json({ok:true});}catch{return Response.json({error:'Invalid session'},{status:400});}}
