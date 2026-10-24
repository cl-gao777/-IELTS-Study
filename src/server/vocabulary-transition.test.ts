import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
vi.mock("server-only",()=>({}));
vi.mock("node:fs",async(original)=>{const fs=await original<typeof import("node:fs")>();return{...fs,existsSync:(file:Parameters<typeof fs.existsSync>[0])=>String(file).endsWith("vocabulary-catalog.json")?false:fs.existsSync(file)};});
const holder=vi.hoisted(()=>({database:null as Database.Database|null}));
vi.mock("./db",()=>({getDatabase:()=>holder.database!}));
import { vocabularyInputSchema } from "@/lib/vocabulary";
import type { VocabularySessionResponse } from "@/lib/vocabulary-session";
import { ensureVocabularyTables, saveVocabularyEntry, listVocabularyEntries } from "./vocabulary";
import { registerVocabularyCourse, selectVocabularyCourse } from "./vocabulary-courses";
import * as sessions from "./vocabulary-session";
import { PUT as sessionPUT } from "@/app/api/vocabulary/session/route";
import { POST as learnPOST } from "@/app/api/vocabulary/[id]/learn/route";
import { POST as reviewPOST } from "@/app/api/vocabulary/[id]/review/route";

const db=()=>holder.database!;
const request=(body:unknown)=>new Request("http://localhost/api/vocabulary",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
async function start(){const r=await sessionPUT(request({action:"start",id:randomUUID(),mode:"recall",restoreVersion:1,advance:true}));expect(r.status).toBe(200);return await r.json() as VocabularySessionResponse;}
function currentWord(state:VocabularySessionResponse){return state.words.find(word=>word.id===state.session!.state.current!.wordId)!;}
async function reveal(state:VocabularySessionResponse){
 const current=state.session!.state.current!,word=currentWord(state);
 const r=await sessionPUT(request({action:"checkpoint",id:state.session!.id,expectedRevision:state.session!.revision,state:{mode:state.session!.state.mode,skippedIds:state.session!.state.skippedIds,courseId:state.session!.state.courseId,current:{...current,phase:"revealed",answer:word.term}}}));
 expect(r.status).toBe(200);return await r.json() as VocabularySessionResponse;
}
function grade(state:VocabularySessionResponse){const word=currentWord(state);return{rating:"good",mode:"recall",userAnswer:word.term,durationSeconds:1,expectedVersion:word.reviewVersion,sessionId:state.session!.id,expectedSessionRevision:state.session!.revision,submissionId:randomUUID(),gaveUp:false,confirmedTypo:false,advance:true};}

beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
 holder.database=new Database(":memory:");
 db().exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE vocabulary_words(id TEXT PRIMARY KEY,term TEXT NOT NULL UNIQUE,pronunciation TEXT NOT NULL,part_of_speech TEXT NOT NULL,meaning_zh TEXT NOT NULL,definition_en TEXT NOT NULL,example TEXT NOT NULL,tags_json TEXT NOT NULL,repetitions INTEGER NOT NULL DEFAULT 0,interval_days INTEGER NOT NULL DEFAULT 0,ease_factor REAL NOT NULL DEFAULT 2.5,due_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE vocabulary_reviews(id INTEGER PRIMARY KEY AUTOINCREMENT,word_id TEXT NOT NULL REFERENCES vocabulary_words(id),rating TEXT NOT NULL,previous_due_at TEXT NOT NULL,next_due_at TEXT NOT NULL,reviewed_at TEXT NOT NULL);
 CREATE TABLE review_items(id INTEGER PRIMARY KEY AUTOINCREMENT,source_type TEXT NOT NULL,source_id TEXT NOT NULL,skill TEXT NOT NULL,prompt TEXT NOT NULL,answer TEXT NOT NULL,resolved INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,category TEXT NOT NULL DEFAULT '',mistake_count INTEGER NOT NULL DEFAULT 1,reviewed_at TEXT NOT NULL DEFAULT '');`);
 ensureVocabularyTables();registerVocabularyCourse({id:"academic",title:"Fixture",description:"test",version:1,kind:"user-import"},[]);selectVocabularyCourse("academic");
 for(const term of ["allocate","coherent","mitigate"])saveVocabularyEntry(vocabularyInputSchema.parse({term,meaningZh:"高级用法"}));
});
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();holder.database?.close();holder.database=null;});

describe("single-response vocabulary transitions",()=>{
 it("reads personal history and learning state in batches independent of vocabulary size",()=>{
  const countReads=()=>{const spy=vi.spyOn(db(),"prepare");const words=listVocabularyEntries();const count=spy.mock.calls.length;spy.mockRestore();return{words,count};};
  const small=countReads();
  const insert=db().prepare("INSERT INTO vocabulary_words SELECT ?,?,pronunciation,part_of_speech,meaning_zh,definition_en,example,tags_json,repetitions,interval_days,ease_factor,due_at,created_at,updated_at FROM vocabulary_words WHERE term='allocate'");
  for(let n=0;n<300;n++)insert.run(`bulk-${n}`,`bulkterm${n}`);
  const large=countReads();expect(large.words).toHaveLength(small.words.length+300);expect(large.count).toBe(small.count);
  expect(large.words.find(word=>word.term==="allocate")).toEqual(small.words.find(word=>word.term==="allocate"));
 });
 it("returns a persisted first card and continues another new word after learning, without waiting for recall",async()=>{
  const first=await start(),word=currentWord(first);
  expect(first.queue?.status).toBe("ready");expect(first.session!.state.current!.phase).toBe("learn");
  const r=await learnPOST(request({expectedVersion:word.reviewVersion,sessionId:first.session!.id,expectedSessionRevision:first.session!.revision,advance:true}),{params:Promise.resolve({id:word.id})});
  expect(r.status).toBe(200);const learned=await r.json() as VocabularySessionResponse;
  expect(learned.session!.state.current!.wordId).not.toBe(word.id);expect(currentWord(learned)).toBeDefined();
  expect(learned.session!.state.learned).toBe(1);expect(learned.queue?.status).toBe("ready");
  expect(sessions.getVocabularySession().session!.state.current).toEqual(learned.session!.state.current);
  expect(db().prepare("SELECT COUNT(*) n FROM vocabulary_reviews").get()).toEqual({n:0});
 });
 it("grades once and returns the next card; replay cannot replace its assignment",async()=>{
  db().prepare("UPDATE vocabulary_words SET repetitions=1,due_at='2000-01-01T00:00:00Z'").run();
  const first=await reveal(await start()),word=currentWord(first),input=grade(first);
  const post=()=>reviewPOST(request(input),{params:Promise.resolve({id:word.id})});
  const r=await post();expect(r.status).toBe(200);const result=await r.json() as VocabularySessionResponse;
  expect(result.session!.state.current!.wordId).not.toBe(word.id);expect(result.session!.state.reviewed).toBe(1);
  const replay=await (await post()).json() as VocabularySessionResponse;
  expect(replay.session).toEqual(result.session);expect(db().prepare("SELECT COUNT(*) n FROM vocabulary_reviews").get()).toEqual({n:1});
 });
 it("keeps a committed grade even when drawing and its recovery read fail, then retries only selection",async()=>{
  db().prepare("UPDATE vocabulary_words SET repetitions=1,due_at='2000-01-01T00:00:00Z'").run();
  const first=await reveal(await start()),word=currentWord(first),input=grade(first);
  vi.spyOn(sessions,"changeVocabularySession").mockImplementationOnce(()=>{throw new Error("injected draw failure");});
  vi.spyOn(sessions,"getVocabularySession").mockImplementationOnce(()=>{throw new Error("injected recovery read failure");});
  const r=await reviewPOST(request(input),{params:Promise.resolve({id:word.id})});expect(r.status).toBe(200);
  const saved=await r.json() as VocabularySessionResponse;expect(saved.nextError).toContain("已保存");expect(saved.session!.state.current).toBeNull();
  const resumed=await sessionPUT(request({action:"next",id:saved.session!.id,expectedRevision:saved.session!.revision}));expect(resumed.status).toBe(200);
  expect((await resumed.json()).session.state.current.wordId).not.toBe(word.id);
  expect(db().prepare("SELECT COUNT(*) n FROM vocabulary_reviews").get()).toEqual({n:1});
 });
 it("returns a real wait time for a single learned word without grading it early",async()=>{
  db().prepare("DELETE FROM vocabulary_words WHERE term<>'allocate'").run();const first=await start(),word=currentWord(first);
  const r=await learnPOST(request({expectedVersion:word.reviewVersion,sessionId:first.session!.id,expectedSessionRevision:first.session!.revision,advance:true}),{params:Promise.resolve({id:word.id})});
  const saved=await r.json() as VocabularySessionResponse;expect(saved.session!.state.current).toBeNull();
  expect(saved.queue).toMatchObject({status:"waiting",nextDueAt:"2030-01-01T00:01:00.000Z"});
  vi.setSystemTime(new Date("2030-01-01T00:00:59Z"));
  expect((await (await sessionPUT(request({action:"next",id:saved.session!.id,expectedRevision:saved.session!.revision}))).json()).session.state.current).toBeNull();
  vi.setSystemTime(new Date("2030-01-01T00:01:00Z"));
  expect((await (await sessionPUT(request({action:"next",id:saved.session!.id,expectedRevision:saved.session!.revision}))).json()).session.state.current.phase).toBe("front");
  expect(db().prepare("SELECT COUNT(*) n FROM vocabulary_reviews").get()).toEqual({n:0});
 });
 it("advances an explicit deferral but does not advance an ordinary input checkpoint",async()=>{
  const first=await start(),card=first.session!.state.current!;
  const typed=await sessionPUT(request({action:"checkpoint",id:first.session!.id,expectedRevision:first.session!.revision,state:{mode:"recall",current:{...card,answer:"local text"},skippedIds:[]}}));
  const saved=await typed.json() as VocabularySessionResponse;expect(saved.session!.state.current!.wordId).toBe(card.wordId);
  const deferred=await sessionPUT(request({action:"checkpoint",id:saved.session!.id,expectedRevision:saved.session!.revision,state:{mode:"context",current:null,skippedIds:[card.wordId]},advance:true}));
  const result=await deferred.json() as VocabularySessionResponse;expect(deferred.status).toBe(200);expect(result.session!.state.current!.wordId).not.toBe(card.wordId);
  expect(listVocabularyEntries().every(word=>!word.hasReviewHistory)).toBe(true);
 });
});
