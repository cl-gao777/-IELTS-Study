import { preferencesSchema,getPreferences,savePreferences } from '@/server/preferences';
import { aiSettingsSchema,aiSettingsSummary,saveAiSettings } from '@/server/ai-settings';
export async function GET(){return Response.json({preferences:getPreferences(),ai:aiSettingsSummary()});}
export async function POST(request:Request){
  try {const body=await request.json();
    if(body.ai){saveAiSettings(aiSettingsSchema.parse(body.ai));return Response.json({ai:aiSettingsSummary()});}
    return Response.json({preferences:savePreferences(preferencesSchema.parse(body))});
  }catch{return Response.json({error:'配置无效，请检查学习时间、目标分数及 AI 地址/密钥。'},{status:400});}
}
