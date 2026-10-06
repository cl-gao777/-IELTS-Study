import "server-only";
import { randomUUID } from "node:crypto";
import type { VocabularyCheckpoint, VocabularySession, VocabularySessionResponse } from "@/lib/vocabulary-session";
import type { VocabularyReviewMode } from "@/lib/vocabulary";
import { getDatabase } from "./db";
import { ensureVocabularyTables, listVocabularyEntries, readVocabularyReviewSubmission, VocabularyReviewConflict } from "./vocabulary";
import { readVocabularySession, requireVocabularySession, VocabularySessionConflict, writeVocabularySession } from "./vocabulary-session-store";

export type VocabularySessionOperation =
  | { action: "start"; id?: string; mode: VocabularyReviewMode }
  | { action: "checkpoint"; id: string; expectedRevision: number; state: VocabularyCheckpoint }
  | { action: "end"; id: string; expectedRevision: number };

export function getVocabularySession(submissionId?: string): VocabularySessionResponse {
  ensureVocabularyTables();
  return { session: readVocabularySession(getDatabase()), words: listVocabularyEntries(),
    ...(submissionId ? { submission: readVocabularyReviewSubmission(submissionId) } : {}) };
}

export function changeVocabularySession(input: VocabularySessionOperation, now = new Date()): VocabularySessionResponse {
  const database = getDatabase();
  ensureVocabularyTables(database);
  return database.transaction(() => {
    if (input.action === "start") {
      const latest = readVocabularySession(database);
      const existing = input.id ? readVocabularySession(database, input.id) : null;
      if (existing) {
        if (existing.id === latest?.id) return getVocabularySession();
        throw new VocabularySessionConflict("这个练习编号属于较早的一轮，请刷新页面。");
      }
      if (latest?.status === "active") throw new VocabularySessionConflict("已有进行中的练习，请先继续或结束本轮。");
      const session: VocabularySession = { id: input.id ?? randomUUID(), revision: 1, status: "active",
        state: { mode: input.mode, current: null, skippedIds: [], reviewed: 0, learned: 0, lastSubmissionId: null },
        startedAt: now.toISOString(), updatedAt: now.toISOString() };
      database.prepare("INSERT INTO vocabulary_sessions (id, revision, status, state_json, started_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run(session.id, session.revision, session.status, JSON.stringify(session.state), session.startedAt, session.updatedAt);
      return getVocabularySession();
    }
    const latest = readVocabularySession(database);
    if (input.action === "end" && latest?.id === input.id && latest.status === "ended") return getVocabularySession();
    const session = requireVocabularySession(database, input.id, input.expectedRevision);
    if (input.action === "end") {
      writeVocabularySession(database, { ...session, status: "ended", state: { ...session.state, current: null } }, now);
      return getVocabularySession();
    }
    const words = listVocabularyEntries();
    const { current } = input.state;
    if (input.state.mode !== session.state.mode && (current || (session.state.current && !input.state.skippedIds.includes(session.state.current.wordId))))
      throw new VocabularySessionConflict("切换方式时请暂缓原词，再练习下一张卡片。");
    if (current) {
      const word = words.find((item) => item.id === current.wordId);
      if (!word) throw new VocabularySessionConflict("词条已不存在，请刷新队列。");
      if (word.reviewVersion !== current.wordVersion) throw new VocabularyReviewConflict(word);
      const isNew = !word.learningStartedAt && !word.hasReviewHistory && word.repetitions <= 0;
      if (isNew !== (current.phase === "learn")) throw new VocabularySessionConflict("词卡学习状态已变化，请刷新队列。");
      if (!isNew && Date.parse(word.dueAt) > now.getTime()) throw new VocabularySessionConflict("这个词尚未到期，请按最新队列继续。");
      const previous = session.state.current;
      if (previous?.wordId === current.wordId && previous.wordVersion === current.wordVersion && previous.phase === "revealed") {
        if (current.phase !== "revealed" || current.answer !== previous.answer || current.gaveUp !== previous.gaveUp || input.state.mode !== session.state.mode)
          throw new VocabularySessionConflict("已核对的原始答案不能修改，请完成评分或结束本轮。");
      }
    }
    writeVocabularySession(database, { ...session, state: { ...session.state, ...input.state,
      skippedIds: [...new Set(input.state.skippedIds)] } }, now);
    return getVocabularySession();
  })();
}
