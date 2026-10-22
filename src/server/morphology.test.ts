import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
vi.mock("./db",()=>({getDatabase:()=>{throw new Error("Use isolated database");}}));
import { getDataEpoch, rotateDataEpoch } from "./data-integrity";
import { ensureMorphologyTables, registerMorphologyLessons, updateMorphologySession, getMorphologyWorkspace, getMorphologyStatistics, submitMorphologyAttempt, lookupMorphologyAttempt, recordMorphologyStudy, refreshMorphologySessionRevisions } from "./morphology";
import { morphologyLessonSchema, morphologySourceSchema, type MorphologyLesson, type MorphologySession } from "@/lib/morphology";

let db:Database.Database;
const now=new Date("2026-10-22T08:00:00.000Z");
const lesson:MorphologyLesson={id:"root:port",version:1,status:"published",kind:"root",rank:1,form:"port",titleZh:"携带",meaningZh:"携带；运送",variants:["port"],overviewZh:"port与携带相关。",spellingZh:"注意前缀。",limitsZh:"不能机械推导全部现代含义。",sources:[{id:"source",title:"Fixture",url:"https://example.com/source",reviewedAt:"2026-10-22",license:"original",note:"test"}],structureQuestion:{prompt:"哪组分析与本课一致？",options:["transport：trans＋port","transport：tran＋sport"],answer:"transport：trans＋port",explanation:"前缀trans表示跨越。"},words:["transport","import","export"].map(term=>({id:term,term,partOfSpeech:"verb",meaningZh:"运输",definitionEn:"To carry.",level:"B2",levelSource:"fixture",relation:"derivation",segments:[{surface:term,meaningZh:"运输"}],explanationZh:"保留语境义。",sourceIds:["source"],illustrative:false,examples:[1,2].map(i=>({id:term+":"+i,sentence:i===1?`We ${term} goods every day.`:`Companies ${term} goods by rail.`,targetSurface:term,acceptedAnswers:[term],meaningZh:"运输"}))}))};
beforeEach(()=>{db=new Database(":memory:");db.pragma("foreign_keys = ON");db.exec("CREATE TABLE study_sessions(id TEXT PRIMARY KEY,study_date TEXT,area TEXT,duration_seconds INTEGER,updated_at TEXT)");registerMorphologyLessons([lesson],db);});
afterEach(()=>db.close());
function start(){return updateMorphologySession({action:"start",dataEpoch:getDataEpoch(db),operationId:randomUUID(),lessonId:lesson.id,lessonVersion:1},db,now).session!;}
function action(s:MorphologySession,action:string,extra={}){return updateMorphologySession({action,dataEpoch:getDataEpoch(db),sessionId:s.id,expectedRevision:s.revision,...extra},db,now).session!;}
function answer(s:MorphologySession,value:string,gaveUp=false){return {dataEpoch:getDataEpoch(db),sessionId:s.id,expectedRevision:s.revision,operationId:randomUUID(),questionId:s.state.questions[s.state.questionIndex].id,lessonVersion:1,answer:value,gaveUp};}
describe("independent morphology study loop",()=>{
  it("rejects unsafe source links, impossible review dates and ambiguous source IDs",()=>{
    const source=lesson.sources[0];
    for(const url of ["javascript:alert(1)","data:text/html,test","file:///local/file","not a URL"])
      expect(morphologySourceSchema.safeParse({...source,url}).success).toBe(false);
    for(const reviewedAt of ["2026-02-29","2026-13-01","2026-10-22T08:00:00Z"])
      expect(morphologySourceSchema.safeParse({...source,reviewedAt}).success).toBe(false);
    expect(morphologySourceSchema.safeParse({...source,reviewedAt:"2024-02-29"}).success).toBe(true);
    expect(morphologySourceSchema.safeParse({...source,url:"http://example.com/source"}).success).toBe(true);
    expect(morphologyLessonSchema.safeParse({...lesson,sources:[source,{...source,url:"https://example.com/other"}]}).success).toBe(false);
  });
  it("initializes only additive tables and preserves frozen shuffled questions and input",()=>{
    const empty=new Database(":memory:");ensureMorphologyTables(empty);expect(empty.prepare("SELECT COUNT(*) n FROM morphology_lessons").get()).toEqual({n:0});empty.close();
    let s=start();const questions=structuredClone(s.state.questions);s=action(s,"practice");s=action(s,"save",{input:"my answer"});
    expect(getMorphologyWorkspace(db).session?.state).toMatchObject({questions,input:"my answer"});
    expect(()=>action({...s,revision:s.revision-1},"save",{input:"older"})).toThrow("其他页面");
  });
  it("makes starts idempotent and allows ending an updated lesson without accepting old grading",()=>{
    const input={action:"start",dataEpoch:getDataEpoch(db),operationId:randomUUID(),lessonId:lesson.id,lessonVersion:1};
    const s=updateMorphologySession(input,db,now).session!;
    expect(updateMorphologySession(input,db,now).session?.id).toBe(s.id);
    expect(()=>updateMorphologySession({...input,retry:"whole"},db,now)).toThrow("不同内容");
    registerMorphologyLessons([{...lesson,version:2}],db);
    expect(()=>action(s,"practice")).toThrow("课程内容已更新");
    expect(action(s,"end").status).toBe("ended");
  });
  it("commits the first raw answer once, detects changed retries and keeps hints immutable",()=>{
    let s=action(start(),"practice");s=action(s,"hint");const input=answer(s,s.state.questions[0].acceptedAnswers[0]);
    const first=submitMorphologyAttempt(input,db,now).session!;
    expect(first.state.results[0]).toMatchObject({correct:true,hintUsed:true,firstAttempt:true});
    expect(submitMorphologyAttempt(input,db,now).session?.state.results).toEqual(first.state.results);
    expect(db.prepare("SELECT COUNT(*) n FROM morphology_attempts").get()).toEqual({n:1});
    expect(()=>submitMorphologyAttempt({...input,answer:"changed"},db)).toThrow("不同");
    expect(()=>action(first,"hint")).toThrow("不能再");
  });
  it("binds unknown-response lookup and repeated submission to the original round when another page starts a new one",()=>{
    let first=action(start(),"practice");const input=answer(first,first.state.questions[0].acceptedAnswers[0]);
    first=submitMorphologyAttempt(input,db,now).session!;first=action(first,"end");
    const second=start();
    const lookup=lookupMorphologyAttempt(input.operationId,getDataEpoch(db),db,now);
    expect(lookup.found).toBe(true);expect(lookup.workspace).toMatchObject({session:{id:first.id,status:"ended"},currentSessionId:second.id,submission:{sessionId:first.id,lessonVersion:1,result:{operationId:input.operationId,answer:input.answer}}});
    const retry=submitMorphologyAttempt(input,db,now);
    expect(retry.session?.id).toBe(first.id);expect(retry.currentSessionId).toBe(second.id);
    expect(db.prepare("SELECT COUNT(*) n FROM morphology_attempts").get()).toEqual({n:1});
    expect(lookupMorphologyAttempt(randomUUID(),getDataEpoch(db),db,now)).toMatchObject({found:false,workspace:{session:{id:second.id}}});
  });
  it("keeps first statistics from unfinished and abandoned runs rather than only completed summaries",()=>{
    let s=action(start(),"practice");s=submitMorphologyAttempt(answer(s,"wrong"),db,now).session!;action(s,"end");
    expect(getMorphologyStatistics(db)).toMatchObject({firstIndependentCorrect:0,firstIndependentTotal:1});
    s=action(start(),"practice");s=submitMorphologyAttempt(answer(s,s.state.questions[0].acceptedAnswers[0]),db,now).session!;
    expect(getMorphologyStatistics(db)).toMatchObject({firstIndependentCorrect:0,firstIndependentTotal:1,repeatedCorrect:1,repeatedTotal:1});
    expect(db.prepare("SELECT COUNT(*) n FROM morphology_runs").get()).toEqual({n:0});
  });
  it("masks repeated target forms from both context sentence and bilingual cue",()=>{
    const changed=structuredClone(lesson);changed.version=2;changed.words[0].examples[0]={...changed.words[0].examples[0],sentence:"We TRANSPORT goods and transport supplies.",meaningZh:"运输 transport；不是答案提示TRANSPORT。"};registerMorphologyLessons([changed],db);
    const s=updateMorphologySession({action:"start",dataEpoch:getDataEpoch(db),operationId:randomUUID(),lessonId:changed.id,lessonVersion:2},db,now).session!;
    const q=s.state.questions[2];expect(q.prompt.toLowerCase()).not.toContain("transport");expect(q.sentence).toContain("TRANSPORT");expect(q.prompt.match(/______/g)).toHaveLength(4);
  });
  it("does not allow empty checking; giving up records an incorrect first answer",()=>{
    const s=action(start(),"practice");expect(()=>submitMorphologyAttempt(answer(s,""),db)).toThrow("输入答案");
    const done=submitMorphologyAttempt(answer(s,"",true),db).session!;expect(done.state.results[0]).toMatchObject({correct:false,gaveUp:true,firstAttempt:true});
  });
  it("uses the word cue rather than the complete v3 sentence translation",()=>{
    const changed=structuredClone(lesson);changed.version=3;
    changed.words[0].examples[0].meaningZh="我们每天运输货物。";
    registerMorphologyLessons([changed],db);
    const s=updateMorphologySession({action:"start",dataEpoch:getDataEpoch(db),operationId:randomUUID(),lessonId:changed.id,lessonVersion:3},db,now).session!;
    expect(s.state.questions[2].prompt).toBe("We ______ goods every day.\n运输");
    expect(s.state.lesson.words[0].examples[0].meaningZh).toBe("我们每天运输货物。");
  });
  it("finishes a complete run, rotates sentences on retry and does not inflate first samples",()=>{
    let s=action(start(),"practice");const firstSentence=s.state.questions[2].sentence;
    while(s.status==="active"){const q=s.state.questions[s.state.questionIndex];s=submitMorphologyAttempt(answer(s,q.acceptedAnswers[0]),db,now).session!;s=action(s,"next");}
    expect(s.state.phase).toBe("results");expect(db.prepare("SELECT completed_runs FROM morphology_progress").get()).toEqual({completed_runs:1});
    const next=start();expect(next.state.retry).toBe("whole");expect(next.state.questions[2].sentence).not.toBe(firstSentence);
    s=action(next,"practice");s=submitMorphologyAttempt(answer(s,s.state.questions[0].acceptedAnswers[0]),db,now).session!;expect(s.state.results[0].firstAttempt).toBe(false);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='vocabulary_reviews'").get()).toBeUndefined();
  });
  it("uses latest completed run for weak retry, including hinted correct questions",()=>{
    let s=action(start(),"practice");s=action(s,"hint");
    while(s.status==="active"){const q=s.state.questions[s.state.questionIndex];s=submitMorphologyAttempt(answer(s,q.acceptedAnswers[0]),db,now).session!;s=action(s,"next");}
    const weak=updateMorphologySession({action:"start",dataEpoch:getDataEpoch(db),operationId:randomUUID(),lessonId:lesson.id,lessonVersion:1,retry:"weak"},db,now).session!;
    expect(weak.state.questions.map(q=>q.kind)).toEqual(["meaning"]);
  });
  it("rejects stale course versions and restores while preserving unsubmitted input",()=>{
    let s=action(start(),"practice");s=action(s,"save",{input:"retained"});const epoch=getDataEpoch(db),revision=s.revision;
    rotateDataEpoch(db);refreshMorphologySessionRevisions(new Map([[s.id,revision]]),db,now);
    expect(getMorphologyWorkspace(db).session).toMatchObject({revision:revision+2,state:{input:"retained",paused:true}});
    expect(()=>updateMorphologySession({action:"save",sessionId:s.id,expectedRevision:revision,dataEpoch:epoch,input:"old"},db)).toThrow("数据已恢复");
    registerMorphologyLessons([{...lesson,version:2}],db);expect(()=>action(getMorphologyWorkspace(db).session!,"resume")).toThrow("课程内容已更新");
  });
  it("records five seconds once across retries and rejects reused segment identity",()=>{
    const s=start(),input={dataEpoch:getDataEpoch(db),sessionId:s.id,segmentId:randomUUID(),seconds:5,studyDate:"2026-10-22"};
    recordMorphologyStudy(input,db,now);recordMorphologyStudy(input,db,now);recordMorphologyStudy({...input,seconds:3},db,now);
    expect(db.prepare("SELECT duration_seconds,area FROM study_sessions").get()).toEqual({duration_seconds:5,area:"Morphology"});
    expect(getMorphologyWorkspace(db,now).todaySeconds).toBe(5);
    expect(()=>recordMorphologyStudy({...input,studyDate:"2026-10-21"},db)).toThrow("身份");
    const epoch=getDataEpoch(db);rotateDataEpoch(db);expect(()=>recordMorphologyStudy({...input,dataEpoch:epoch,seconds:10},db)).toThrow("数据已恢复");
  });
  it("accepts sealed offline packets after the course ends but rejects invalid or future dates",()=>{
    let s=start();s=action(s,"end");const input={dataEpoch:getDataEpoch(db),sessionId:s.id,segmentId:randomUUID(),seconds:5,studyDate:"2026-10-22"};
    expect(recordMorphologyStudy(input,db,now).todaySeconds).toBe(5);
    expect(()=>recordMorphologyStudy({...input,segmentId:randomUUID(),studyDate:"2026-02-30"},db,now)).toThrow("计时日期无效");
    expect(()=>recordMorphologyStudy({...input,segmentId:randomUUID(),studyDate:"2026-10-23"},db,now)).toThrow("有效范围");
  });
});
