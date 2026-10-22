import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import curriculum from "@/data/morphology-curriculum.json";
vi.mock("server-only",()=>({}));
const holder=vi.hoisted(()=>({database:null as Database.Database|null}));
vi.mock("./db",async original=>({...await original<typeof import("./db")>(),getDatabase:()=>holder.database!}));
vi.mock("./vocabulary-courses",async original=>({...await original<typeof import("./vocabulary-courses")>(),loadVocabularyCatalog:()=>undefined}));
import { migrate } from "./db";
import { getDataEpoch } from "./data-integrity";
import { registerMorphologyLessons } from "./morphology";
import { enrollMorphologyWord } from "./morphology-enrollment";
import { ensureVocabularyTables, saveVocabularyEntry } from "./vocabulary";
import { getVocabularyStudy, registerVocabularyCourse } from "./vocabulary-courses";
import { changeVocabularySession } from "./vocabulary-session";
import { selectVocabularyTargetCard } from "./vocabulary-target-selection";
import { morphologyLessonSchema, type MorphologyLesson } from "@/lib/morphology";
import { vocabularyInputSchema } from "@/lib/vocabulary";
import type { VocabularySession } from "@/lib/vocabulary-session";

let db:Database.Database,lesson:MorphologyLesson;
const now=new Date("2026-10-22T08:00:00Z");
beforeEach(()=>{
  db=new Database(":memory:");holder.database=db;db.pragma("foreign_keys = ON");migrate(db);ensureVocabularyTables(db);getVocabularyStudy(now,db);
  lesson=morphologyLessonSchema.parse(structuredClone(curriculum.lessons.find(item=>item.words.every(word=>!word.illustrative))!));
  lesson.id="integration:lesson";lesson.version=1;lesson.words[0].level="B2";lesson.words[0].levelSource="Synthetic test level";
  registerMorphologyLessons([lesson],db);
  const sentences=["We study legacyword every day.","This course teaches legacyword clearly."];
  registerVocabularyCourse({id:"legacy",title:"Legacy original course",description:"fixture",kind:"user-import",version:1},[{
    id:"legacy-entry",term:"legacyword",meaningZh:"原课程词",definitionEn:"Synthetic fixture.",partOfSpeech:"noun",rank:1,courseIds:["legacy"],exercises:sentences.map((sentence,i)=>({id:"legacy-exercise:"+i,version:1,status:"published",sentence,targetStart:sentence.indexOf("legacyword"),targetEnd:sentence.indexOf("legacyword")+10,targetSurface:"legacyword",acceptedAnswers:["legacyword"],meaningZh:"原课程词",source:"test fixture"}))
  }],db);
  db.prepare("INSERT INTO vocabulary_study_preferences(id,active_course_id,focus,next_level) VALUES(1,'legacy','general','B2')").run();
});
afterEach(()=>{db.close();holder.database=null;});
const request=()=>({dataEpoch:getDataEpoch(db),operationId:randomUUID(),lessonId:lesson.id,lessonVersion:1,wordId:lesson.words[0].id});
const fakeSession=():VocabularySession=>({id:randomUUID(),revision:1,status:"active",startedAt:now.toISOString(),updatedAt:now.toISOString(),state:{mode:"context",courseId:"legacy",current:null,skippedIds:[],reviewed:0,learned:0,supplementalReviewed:0,lastSubmissionId:null}});

describe("morphology enrollment preserves existing learning sources",()=>{
  it("continues legacy new words while an overdue selected sense waits for its first minute recall",()=>{
    const enrolled=enrollMorphologyWord(request(),db);
    db.prepare("UPDATE vocabulary_words SET repetitions=2,due_at=? WHERE id=?").run("2026-01-01T00:00:00Z",enrolled.wordId);
    db.prepare("INSERT INTO vocabulary_target_state(target_id,word_id,normalized_term,version,paused,introduced_at,step,due_at,last_submission_id,updated_at) VALUES(?,?,?,1,0,?,1,?,NULL,?)")
      .run(enrolled.targetId,enrolled.wordId,lesson.words[0].term.toLowerCase(),now.toISOString(),new Date(now.getTime()+60000).toISOString(),now.toISOString());
    const started=changeVocabularySession({action:"start",mode:"context",restoreVersion:1},now).session!;
    const next=changeVocabularySession({action:"next",id:started.id,expectedRevision:started.revision},now).session!;
    const selectedWord=next.state.current&&db.prepare("SELECT term FROM vocabulary_words WHERE id=?").get(next.state.current.wordId);
    expect(selectedWord).toEqual({term:"legacyword"});
    expect(getVocabularyStudy(now,db).activeCourseId).toBe("legacy");
  });
  it("treats a normalized existing phrase as the same enrollment without advancing membership versions",()=>{
    const word=lesson.words[0];word.term="in vitro";word.id="integration:in-vitro";word.examples=[1,2].map(i=>({id:"in-vitro:"+i,sentence:i===1?"Researchers test cells in vitro first.":"The treatment worked in vitro under controlled conditions.",targetSurface:"in vitro",acceptedAnswers:["in vitro"],meaningZh:"在体外"}));
    registerMorphologyLessons([{...lesson,version:2}],db);
    saveVocabularyEntry(vocabularyInputSchema.parse({term:"IN  VITRO",meaningZh:"我的私人释义"}));
    const input={...request(),lessonVersion:2},first=enrollMorphologyWord(input,db);
    const definitions=db.prepare("SELECT data_json FROM vocabulary_catalog_entries ORDER BY id").all();
    expect(enrollMorphologyWord({...input,operationId:randomUUID()},db)).toMatchObject({status:"existing",wordId:first.wordId,targetId:first.targetId});
    expect(db.prepare("SELECT data_json FROM vocabulary_catalog_entries ORDER BY id").all()).toEqual(definitions);
  });
  it("keeps unknown-level hand selections outside the advanced queue and leaves course preferences unchanged",()=>{
    lesson.words[0].level=null;lesson.words[0].levelSource="";registerMorphologyLessons([{...lesson,version:2}],db);
    const enrolled=enrollMorphologyWord({...request(),lessonVersion:2},db);
    db.prepare("UPDATE vocabulary_study_preferences SET focus='ielts-advanced'").run();
    expect(selectVocabularyTargetCard(fakeSession(),now,db)).toBeNull();
    expect(enrolled.message).toContain("已加入");
    expect(getVocabularyStudy(now,db)).toMatchObject({activeCourseId:"legacy",focus:"ielts-advanced",nextLevel:"B2"});
  });
});
