import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { getDatabase } from "./db";
import { assertDataEpoch, getDataEpoch } from "./data-integrity";
import { studyDate } from "./preferences";
import { morphologyLessonSchema, morphologySessionInputSchema, morphologyAttemptInputSchema, morphologyStudyInputSchema,
  normaliseMorphologyAnswer, morphologyContextPrompt, type MorphologyLesson, type MorphologySession, type MorphologySessionState, type MorphologyQuestion,
  type MorphologyProgress, type MorphologyHistory, type MorphologyAnswerResult, type MorphologyWorkspace, type MorphologyCoursesResponse, type MorphologyStatistics } from "@/lib/morphology";

export class MorphologyConflict extends Error { readonly status = 409; readonly code = "MORPHOLOGY_CONFLICT"; }
const loadedDatabases = new WeakSet<Database.Database>();
export function ensureMorphologyTables(database: Database.Database = getDatabase()) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS morphology_lessons (id TEXT PRIMARY KEY,version INTEGER NOT NULL,data_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS morphology_progress (lesson_id TEXT PRIMARY KEY REFERENCES morphology_lessons(id),read_at TEXT,completed_at TEXT,completed_runs INTEGER NOT NULL DEFAULT 0,last_correct INTEGER NOT NULL DEFAULT 0,last_total INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS morphology_sessions (id TEXT PRIMARY KEY,revision INTEGER NOT NULL,status TEXT NOT NULL,state_json TEXT NOT NULL,started_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS morphology_attempts (id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES morphology_sessions(id),lesson_id TEXT NOT NULL,lesson_version INTEGER NOT NULL,question_id TEXT NOT NULL,request_hash TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(session_id,question_id));
    CREATE TABLE IF NOT EXISTS morphology_runs (id TEXT PRIMARY KEY REFERENCES morphology_sessions(id),lesson_id TEXT NOT NULL,lesson_version INTEGER NOT NULL,result_json TEXT NOT NULL,completed_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS morphology_operations (id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,session_id TEXT NOT NULL REFERENCES morphology_sessions(id));
    CREATE TABLE IF NOT EXISTS morphology_study_segments (id TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES morphology_sessions(id),data_epoch TEXT NOT NULL,study_date TEXT NOT NULL,seconds INTEGER NOT NULL,updated_at TEXT NOT NULL);
  `);
}
export function registerMorphologyLessons(inputs: readonly unknown[], database: Database.Database = getDatabase()) {
  ensureMorphologyTables(database);
  const lessons = inputs.map(input => morphologyLessonSchema.parse(input));
  if (new Set(lessons.map(l=>l.id)).size !== lessons.length) throw new Error("词根课程ID重复。");
  database.transaction(()=>{
    for (const lesson of lessons) {
      const existing = database.prepare("SELECT version,data_json FROM morphology_lessons WHERE id=?").get(lesson.id) as {version:number;data_json:string}|undefined;
      if (existing && existing.version === lesson.version && existing.data_json !== JSON.stringify(lesson)) throw new Error("课程内容变化必须提升版本。");
      database.prepare("INSERT INTO morphology_lessons(id,version,data_json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,data_json=excluded.data_json WHERE excluded.version>morphology_lessons.version")
        .run(lesson.id,lesson.version,JSON.stringify(lesson));
    }
  })();
  loadedDatabases.add(database);
}
export function invalidateMorphologyCurriculum(database:Database.Database=getDatabase()){ loadedDatabases.delete(database); }
export function loadMorphologyCurriculum(database: Database.Database = getDatabase()) {
  if (loadedDatabases.has(database)) return;
  const input = JSON.parse(readFileSync(path.join(/* turbopackIgnore: true */ process.cwd(), "src/data/morphology-curriculum.json"),"utf8")) as unknown;
  registerMorphologyLessons(Array.isArray(input) ? input : (input as {lessons:unknown[]}).lessons,database);
}
export function getMorphologyLesson(id: string, database: Database.Database = getDatabase()): MorphologyLesson {
  ensureMorphologyTables(database);
  // A newly started server must compare old pages with the installed package,
  // not merely with definitions left by the previous application version.
  loadMorphologyCurriculum(database);
  let row=database.prepare("SELECT data_json FROM morphology_lessons WHERE id=?").get(id) as {data_json:string}|undefined;
  if (!row) { loadMorphologyCurriculum(database); row=database.prepare("SELECT data_json FROM morphology_lessons WHERE id=?").get(id) as {data_json:string}|undefined; }
  if (!row) throw new MorphologyConflict("课程不存在，请返回课程目录刷新。");
  const lesson=morphologyLessonSchema.parse(JSON.parse(row.data_json));
  if (lesson.status!=="published") throw new MorphologyConflict("本课尚未核准发布，请选择其他课程。");
  return lesson;
}
function progress(database: Database.Database): MorphologyProgress[] {
  return (database.prepare("SELECT * FROM morphology_progress").all() as {lesson_id:string;read_at:string|null;completed_at:string|null;completed_runs:number;last_correct:number;last_total:number}[])
    .map(r=>({lessonId:r.lesson_id,readAt:r.read_at,completedAt:r.completed_at,completedRuns:r.completed_runs,lastCorrect:r.last_correct,lastTotal:r.last_total}));
}
export function getMorphologyCourses(lessonId?: string, database: Database.Database = getDatabase(), now=new Date()): MorphologyCoursesResponse {
  ensureMorphologyTables(database); loadMorphologyCurriculum(database);
  const p=progress(database),time=studySeconds(database,now);
  const kindOrder={root:0,prefix:1,suffix:2};
  const lessons=(database.prepare("SELECT data_json FROM morphology_lessons ORDER BY id").all() as {data_json:string}[]).map(r=>morphologyLessonSchema.parse(JSON.parse(r.data_json))).filter(l=>l.status==="published").sort((a,b)=>kindOrder[a.kind]-kindOrder[b.kind]||a.rank-b.rank);
  const history=(database.prepare("SELECT result_json FROM morphology_runs ORDER BY completed_at DESC LIMIT 100").all() as {result_json:string}[]).map(r=>JSON.parse(r.result_json) as MorphologyHistory);
  return {dataEpoch:getDataEpoch(database),courses:lessons.map(l=>({id:l.id,version:l.version,kind:l.kind,rank:l.rank,form:l.form,titleZh:l.titleZh,meaningZh:l.meaningZh,wordCount:l.words.length,progress:p.find(x=>x.lessonId===l.id)??null})),
    ...(lessonId?{lesson:getMorphologyLesson(lessonId,database)}:{}),history,statistics:getMorphologyStatistics(database),...time};
}
export function getMorphologyStatistics(database:Database.Database=getDatabase()):MorphologyStatistics{
  ensureMorphologyTables(database);
  const rows=(database.prepare("SELECT result_json FROM morphology_attempts").all() as {result_json:string}[]).map(row=>JSON.parse(row.result_json) as MorphologyAnswerResult);
  const first=rows.filter(r=>r.firstAttempt&&!r.hintUsed),hinted=rows.filter(r=>r.hintUsed),repeated=rows.filter(r=>!r.firstAttempt&&!r.hintUsed);
  return {firstIndependentCorrect:first.filter(r=>r.correct).length,firstIndependentTotal:first.length,hintedCorrect:hinted.filter(r=>r.correct).length,hintedTotal:hinted.length,repeatedCorrect:repeated.filter(r=>r.correct).length,repeatedTotal:repeated.length};
}
function readSession(database: Database.Database,id?:string): MorphologySession|null {
  const row=(id?database.prepare("SELECT * FROM morphology_sessions WHERE id=?").get(id):database.prepare("SELECT * FROM morphology_sessions ORDER BY (status='active') DESC,updated_at DESC,rowid DESC LIMIT 1").get()) as {id:string;revision:number;status:"active"|"ended";state_json:string;started_at:string;updated_at:string}|undefined;
  return row?{id:row.id,revision:row.revision,status:row.status,state:JSON.parse(row.state_json) as MorphologySessionState,startedAt:row.started_at,updatedAt:row.updated_at}:null;
}
function studySeconds(database:Database.Database,now:Date) {
  const all=database.prepare("SELECT COALESCE(SUM(seconds),0) seconds FROM morphology_study_segments").get() as {seconds:number};
  const today=database.prepare("SELECT COALESCE(SUM(seconds),0) seconds FROM morphology_study_segments WHERE study_date=?").get(studyDate(now)) as {seconds:number};
  return {todaySeconds:today.seconds,totalSeconds:all.seconds};
}
export function getMorphologyWorkspace(database:Database.Database=getDatabase(),now=new Date()):MorphologyWorkspace {
  ensureMorphologyTables(database); return {dataEpoch:getDataEpoch(database),session:readSession(database),...studySeconds(database,now)};
}
function writeSession(session:MorphologySession,database:Database.Database,now:Date) {
  session.revision++;session.updatedAt=now.toISOString();
  database.prepare("UPDATE morphology_sessions SET revision=?,status=?,state_json=?,updated_at=? WHERE id=?").run(session.revision,session.status,JSON.stringify(session.state),session.updatedAt,session.id);
}
function requireSession(id:string,revision:number,database:Database.Database,checkContent=true) {
  const s=readSession(database,id);
  if (!s || s.status!=="active" || s.revision!==revision) throw new MorphologyConflict("本轮已在其他页面变化，请保留输入并刷新。");
  if (checkContent) {
    const current=getMorphologyLesson(s.state.lesson.id,database);
    if (current.version!==s.state.lesson.version) throw new MorphologyConflict("课程内容已更新，请保留输入并重新开始本课。");
  }
  return s;
}
const shuffled=<T>(values:readonly T[]):T[]=>{const list=[...values];for(let i=list.length-1;i>0;i--){const at=Math.floor(Math.random()*(i+1));[list[i],list[at]]=[list[at],list[i]];}return list;};
function buildQuestions(lesson:MorphologyLesson,database:Database.Database,run:number):MorphologyQuestion[] {
  const other=(database.prepare("SELECT data_json FROM morphology_lessons WHERE id<>? ORDER BY id").all(lesson.id) as {data_json:string}[]).map(r=>morphologyLessonSchema.parse(JSON.parse(r.data_json))).filter(l=>l.status==="published"&&l.meaningZh!==lesson.meaningZh);
  const meanings=lesson.meaningDistractors??[...new Set(other.map(l=>l.meaningZh))].slice(0,3);
  const questions:MorphologyQuestion[]=[{id:lesson.id+":meaning",kind:"meaning",prompt:`本课中 ${lesson.form} 表达的核心含义是什么？`,options:shuffled([lesson.meaningZh,...meanings]),acceptedAnswers:[lesson.meaningZh],hint:lesson.overviewZh,explanation:lesson.overviewZh,sentence:"",wordId:null},
    {id:lesson.id+":structure",kind:"structure",prompt:lesson.structureQuestion.prompt,options:shuffled(lesson.structureQuestion.options),acceptedAnswers:[lesson.structureQuestion.answer],hint:lesson.spellingZh,explanation:lesson.structureQuestion.explanation,sentence:"",wordId:null}];
  for(const word of lesson.words){const example=word.examples[run%word.examples.length],prompt=morphologyContextPrompt(example);
    if(!prompt.slice(0,prompt.indexOf("\n")).includes("______"))throw new Error("语境题无法安全遮蔽目标词。");
    questions.push({id:lesson.id+":context:"+word.id,kind:"context",prompt,options:[],acceptedAnswers:example.acceptedAnswers,hint:word.segments.map(s=>s.surface+"（"+s.meaningZh+"）").join(" + "),explanation:word.explanationZh,sentence:example.sentence,wordId:word.id});}
  return questions;
}
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function updateMorphologySession(raw:unknown,database:Database.Database=getDatabase(),now=new Date()):MorphologyWorkspace {
  const input=morphologySessionInputSchema.parse(raw);ensureMorphologyTables(database);
  return database.transaction(()=>{
    assertDataEpoch(input.dataEpoch,database);
    if(input.action==="start"){
      const previous=database.prepare("SELECT request_hash,session_id FROM morphology_operations WHERE id=?").get(input.operationId) as {request_hash:string;session_id:string}|undefined;
      if(previous){if(previous.request_hash!==hash(input))throw new MorphologyConflict("同一操作编号不能提交不同内容。");return {...getMorphologyWorkspace(database,now),session:readSession(database,previous.session_id)};}
      const active=readSession(database);if(active?.status==="active")throw new MorphologyConflict("已有进行中的课程，请继续或先结束本轮。");
      const lesson=getMorphologyLesson(input.lessonId,database);if(lesson.version!==input.lessonVersion)throw new MorphologyConflict("课程版本已更新，请刷新目录。");
      const count=(database.prepare("SELECT COUNT(*) n FROM morphology_runs WHERE lesson_id=?").get(lesson.id) as {n:number}).n;
      let questions=buildQuestions(lesson,database,count);
      if(input.retry==="weak"){
        const last=database.prepare("SELECT s.state_json FROM morphology_runs r JOIN morphology_sessions s ON s.id=r.id WHERE r.lesson_id=? ORDER BY r.completed_at DESC,r.rowid DESC LIMIT 1").get(lesson.id) as {state_json:string}|undefined;
        const weak=last?new Set((JSON.parse(last.state_json) as MorphologySessionState).results.filter(r=>!r.correct||r.hintUsed).map(r=>r.questionId)):new Set<string>();
        questions=questions.filter(q=>weak.has(q.id));if(!questions.length)throw new MorphologyConflict("这课暂无答错或使用提示的题目，可选择重练整课。");
      }
      const session:MorphologySession={id:randomUUID(),revision:1,status:"active",startedAt:now.toISOString(),updatedAt:now.toISOString(),state:{lesson,phase:"learn",questionIndex:0,questions,input:"",hintUsed:false,results:[],retry:input.retry === "initial" && count ? "whole" : input.retry,paused:false}};
      database.prepare("INSERT INTO morphology_sessions VALUES(?,?,?,?,?,?)").run(session.id,1,"active",JSON.stringify(session.state),session.startedAt,session.updatedAt);
      database.prepare("INSERT INTO morphology_operations VALUES(?,?,?)").run(input.operationId,hash(input),session.id);
      return getMorphologyWorkspace(database,now);
    }
    const session=requireSession(input.sessionId,input.expectedRevision,database,input.action!=="end"),state=session.state;
    if(input.action==="save"){if(state.phase==="practice"&&!state.results.some(r=>r.questionId===state.questions[state.questionIndex]?.id))state.input=input.input;}
    if(input.action==="practice"){
      if(state.phase!=="learn")throw new MorphologyConflict("当前不在教学阶段。");state.phase="practice";
      database.prepare("INSERT INTO morphology_progress(lesson_id,read_at) VALUES(?,?) ON CONFLICT(lesson_id) DO UPDATE SET read_at=COALESCE(read_at,excluded.read_at)").run(state.lesson.id,now.toISOString());
    }
    if(input.action==="hint"){if(state.phase!=="practice"||state.results.some(r=>r.questionId===state.questions[state.questionIndex]?.id))throw new MorphologyConflict("当前题目不能再请求提示。");state.hintUsed=true;}
    if(input.action==="pause")state.paused=true;
    if(input.action==="resume")state.paused=false;
    if(input.action==="end"){session.status="ended";state.paused=true;}
    if(input.action==="next"){
      if(state.phase!=="practice"||!state.results.some(r=>r.questionId===state.questions[state.questionIndex]?.id))throw new MorphologyConflict("请先核对当前题目。");
      if(state.questionIndex+1<state.questions.length){state.questionIndex++;state.input="";state.hintUsed=false;}else completeRun(session,database,now);
    }
    writeSession(session,database,now);return getMorphologyWorkspace(database,now);
  })();
}
function completeRun(session:MorphologySession,database:Database.Database,now:Date){
  const s=session.state;s.phase="results";s.paused=true;session.status="ended";
  const result:MorphologyHistory={id:session.id,lessonId:s.lesson.id,lessonVersion:s.lesson.version,lessonTitle:s.lesson.titleZh,retry:s.retry,completedAt:now.toISOString(),correct:s.results.filter(r=>r.correct).length,total:s.questions.length,independentCorrect:s.results.filter(r=>!r.hintUsed&&r.correct).length,independentTotal:s.results.filter(r=>!r.hintUsed).length,hintedCorrect:s.results.filter(r=>r.hintUsed&&r.correct).length,hintedTotal:s.results.filter(r=>r.hintUsed).length,firstIndependentCorrect:s.results.filter(r=>r.firstAttempt&&!r.hintUsed&&r.correct).length,firstIndependentTotal:s.results.filter(r=>r.firstAttempt&&!r.hintUsed).length};
  database.prepare("INSERT INTO morphology_runs VALUES(?,?,?,?,?)").run(session.id,s.lesson.id,s.lesson.version,JSON.stringify(result),now.toISOString());
  database.prepare("INSERT INTO morphology_progress(lesson_id,completed_at,completed_runs,last_correct,last_total) VALUES(?,?,1,?,?) ON CONFLICT(lesson_id) DO UPDATE SET completed_at=excluded.completed_at,completed_runs=completed_runs+1,last_correct=excluded.last_correct,last_total=excluded.last_total").run(s.lesson.id,now.toISOString(),result.correct,result.total);
}
export function submitMorphologyAttempt(raw:unknown,database:Database.Database=getDatabase(),now=new Date()):MorphologyWorkspace{
  const input=morphologyAttemptInputSchema.parse(raw);ensureMorphologyTables(database);
  return database.transaction(()=>{
    assertDataEpoch(input.dataEpoch,database);
    const duplicate=database.prepare("SELECT request_hash FROM morphology_attempts WHERE id=?").get(input.operationId) as {request_hash:string}|undefined;
    if(duplicate){if(duplicate.request_hash!==hash(input))throw new MorphologyConflict("重复提交的内容不同，原记录已保留。");return lookupMorphologyAttempt(input.operationId,input.dataEpoch,database,now).workspace;}
    const session=requireSession(input.sessionId,input.expectedRevision,database),state=session.state,q=state.questions[state.questionIndex];
    if(state.paused||state.phase!=="practice"||!q||q.id!==input.questionId||state.lesson.version!==input.lessonVersion)throw new MorphologyConflict("题目或课程状态已变化，请保留输入并刷新。");
    if(state.results.some(r=>r.questionId===q.id))throw new MorphologyConflict("本题已经核对，不能改写首次答案。");
    if(!input.gaveUp&&!input.answer.trim())throw new Error("请先输入答案，或选择想不起来。");
    const result:MorphologyAnswerResult={questionId:q.id,answer:input.answer,correct:!input.gaveUp&&q.acceptedAnswers.some(a=>normaliseMorphologyAnswer(a)===normaliseMorphologyAnswer(input.answer)),hintUsed:state.hintUsed,gaveUp:input.gaveUp,firstAttempt:!database.prepare("SELECT 1 FROM morphology_attempts WHERE lesson_id=? AND question_id=? LIMIT 1").get(state.lesson.id,q.id),acceptedAnswers:q.acceptedAnswers,explanation:q.explanation,sentence:q.sentence,submittedAt:now.toISOString(),operationId:input.operationId};
    database.prepare("INSERT INTO morphology_attempts VALUES(?,?,?,?,?,?,?,?)").run(input.operationId,session.id,state.lesson.id,state.lesson.version,q.id,hash(input),JSON.stringify(result),now.toISOString());
    state.input=input.answer;state.results.push(result);writeSession(session,database,now);return lookupMorphologyAttempt(input.operationId,input.dataEpoch,database,now).workspace;
  })();
}
export function lookupMorphologyAttempt(operationId:string,dataEpoch:string,database:Database.Database=getDatabase(),now=new Date()){
  assertDataEpoch(dataEpoch,database);ensureMorphologyTables(database);
  const row=database.prepare("SELECT session_id,lesson_version,result_json FROM morphology_attempts WHERE id=?").get(operationId) as {session_id:string;lesson_version:number;result_json:string}|undefined;
  const current=getMorphologyWorkspace(database,now);
  if(!row)return {found:false,workspace:current};
  const submission={sessionId:row.session_id,lessonVersion:row.lesson_version,result:JSON.parse(row.result_json) as MorphologyAnswerResult};
  const workspace:MorphologyWorkspace={...current,currentSessionId:current.session?.id??null,session:readSession(database,row.session_id),submission};
  return {found:true,workspace,submission};
}
export function recordMorphologyStudy(raw:unknown,database:Database.Database=getDatabase(),now=new Date()):MorphologyWorkspace{
  const input=morphologyStudyInputSchema.parse(raw);ensureMorphologyTables(database);
  return database.transaction(()=>{
    assertDataEpoch(input.dataEpoch,database);
    const session=readSession(database,input.sessionId);
    if(!session)throw new MorphologyConflict("本轮课程不存在。");
    const previous=database.prepare("SELECT * FROM morphology_study_segments WHERE id=?").get(input.segmentId) as {session_id:string;data_epoch:string;study_date:string;seconds:number}|undefined;
    if(previous&&(previous.session_id!==input.sessionId||previous.data_epoch!==input.dataEpoch||previous.study_date!==input.studyDate))throw new MorphologyConflict("计时片段身份不匹配。");
    if(input.studyDate<studyDate(new Date(session.startedAt))||input.studyDate>studyDate(now))throw new MorphologyConflict("计时日期超出本轮课程的有效范围。");
    const seconds=Math.max(previous?.seconds??0,input.seconds),delta=seconds-(previous?.seconds??0);
    database.prepare("INSERT INTO morphology_study_segments VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET seconds=excluded.seconds,updated_at=excluded.updated_at").run(input.segmentId,input.sessionId,input.dataEpoch,input.studyDate,seconds,now.toISOString());
    if(delta)database.prepare("INSERT INTO study_sessions(id,study_date,area,duration_seconds,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET duration_seconds=duration_seconds+excluded.duration_seconds,updated_at=excluded.updated_at").run("morphology:"+input.segmentId,input.studyDate,"Morphology",delta,now.toISOString());
    return getMorphologyWorkspace(database,now);
  })();
}
/** Restore calls this in its replacement transaction after rotating dataEpoch. */
export function refreshMorphologySessionRevisions(previous:Map<string,number>,database:Database.Database=getDatabase(),now=new Date()){
  ensureMorphologyTables(database);
  for(const row of database.prepare("SELECT id,revision,state_json FROM morphology_sessions").all() as {id:string;revision:number;state_json:string}[]){
    const state=JSON.parse(row.state_json) as MorphologySessionState;state.paused=true;
    database.prepare("UPDATE morphology_sessions SET revision=?,state_json=?,updated_at=? WHERE id=?").run(Math.max(row.revision,previous.get(row.id)??0)+2,JSON.stringify(state),now.toISOString(),row.id);
  }
}
