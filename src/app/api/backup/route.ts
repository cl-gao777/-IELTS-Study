import {createBackup,restoreBackup,databaseBackup} from '@/server/backup';
export async function GET(request:Request){
 try {if(new URL(request.url).searchParams.get('format')==='sqlite')return new Response(new Uint8Array(await databaseBackup()),{headers:{'Content-Type':'application/vnd.sqlite3','Content-Disposition':'attachment; filename="ielts-studio.db"','Cache-Control':'no-store'}});
 return Response.json(createBackup(),{headers:{'Content-Disposition':`attachment; filename="ielts-studio-${new Date().toISOString().slice(0,10)}.json"`,'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'备份失败'},{status:400});}
}
export async function POST(request:Request){try{if(Number(request.headers.get('content-length'))>360*1024*1024)throw new Error('备份文件太大。');const data=await request.json();if(data.confirm!=='RESTORE')throw new Error('请确认恢复。');return Response.json({ok:true,...restoreBackup(data.backup)});}catch(e){return Response.json({error:e instanceof Error?e.message:'恢复失败，现有数据已保留。'},{status:400});}}
