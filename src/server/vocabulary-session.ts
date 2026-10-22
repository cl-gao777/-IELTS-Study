import "server-only";
import { randomUUID } from "node:crypto";
import type { VocabularyCheckpoint, VocabularySession, VocabularySessionResponse } from "@/lib/vocabulary-session";
import { normaliseVocabularyAnswer, type VocabularyReviewMode } from "@/lib/vocabulary";
import { getDatabase } from "./db";
import { ensureVocabularyTables, listVocabularyEntries, readVocabularyReviewSubmission, VocabularyReviewConflict } from "./vocabulary";
import { readVocabularySession, requireVocabularySession, VocabularySessionConflict, writeVocabularySession } from "./vocabulary-session-store";
import { getVocabularyStudy, isVocabularyExerciseCurrent, listVocabularyCatalogEntries, loadVocabularyCatalog, materializeVocabularyCatalogEntry, requireVocabularyStudyVersion, selectVocabularyCourse, supplementalVocabularyExerciseForWord, vocabularyExerciseForWord } from "./vocabulary-courses";
import { vocabularyRecallCue } from "@/lib/vocabulary-practice";
import { isVocabularyCatalogEntryLearnable } from "@/lib/vocabulary-course";
import { selectVocabularyTargetCard, vocabularyQueuePreview } from "./vocabulary-target-selection";
import { morphologySelectedTargetRanks } from "./vocabulary-selected-targets";
import { listVocabularyTargetStates, listVocabularyTermDispositions, getVocabularyTargetCounts, isVocabularyTargetCardCurrent, isVocabularyTermPaused, readVocabularyTargetDefinitions, vocabularyTargetEligible } from "./vocabulary-targets";

export type VocabularySessionOperation =
  | { action: "start"; id?: string; mode: VocabularyReviewMode; courseId?: string | null; restoreVersion?: number }
  | { action: "checkpoint"; id: string; expectedRevision: number; state: VocabularyCheckpoint }
  | { action: "end"; id: string; expectedRevision: number }
  | { action: "next"; id: string; expectedRevision: number };

export function getVocabularySession(submissionId?: string): VocabularySessionResponse {
  ensureVocabularyTables();
  const database = getDatabase(); loadVocabularyCatalog(database); let session = readVocabularySession(database); let error: string | undefined;
  const words = listVocabularyEntries();
  const current = session?.state.current;
  const word = current ? words.find((item) => item.id === current.wordId) : undefined;
  const settings = getVocabularyStudy(new Date(), database);
  if (session?.status === "active" && current && (!word || word.reviewVersion !== current.wordVersion || !isVocabularyTargetCardCurrent(current, word, database) || !isVocabularyExerciseCurrent(current.exercise, database))) {
    // An external content edit is not a one-step checkpoint acknowledgement. The
    // two-step revision prevents an old browser draft from being recovered over it.
    session = writeVocabularySession(database, { ...session, revision: session.revision + 1, state: { ...session.state, current: null } }, new Date());
    error = "题目已修改或下架，原答案尚未评分；已同步，可继续最新题卡。";
  } else if (session?.status === "active" && current && word) {
    const canSupplement = (!current.target || current.purpose === "scheduled") && !current.supplemental && current.phase !== "learn" && session.state.mode === "context"
      && Boolean(supplementalVocabularyExerciseForWord(word, current.exercise, session.state.courseId, database));
    if (canSupplement !== Boolean(current.canSupplement)) session = writeVocabularySession(database, { ...session,
      revision: session.revision + 1, state: { ...session.state, current: { ...current, canSupplement } } }, new Date());
  }
  const definitions = readVocabularyTargetDefinitions(database);
  const eligibleWordIds = words.filter((item) => !isVocabularyTermPaused(item.term, database) && (settings.focus !== "ielts-advanced"
    || definitions.some(({ entry, target }) => normaliseVocabularyAnswer(entry.term) === normaliseVocabularyAnswer(item.term) && vocabularyTargetEligible(entry, target, "ielts-advanced", database)))).map((item) => item.id);
  return { session, words, eligibleWordIds, targetStates: listVocabularyTargetStates(database), termDispositions: listVocabularyTermDispositions(database),
    queuePreview: vocabularyQueuePreview(words.filter((item) => eligibleWordIds.includes(item.id)), session, new Date(), database),
    targetCounts: getVocabularyTargetCounts(settings.focus ?? "general", new Date(), database), ...(error ? { error } : {}),
    ...(submissionId ? { submission: readVocabularyReviewSubmission(submissionId) } : {}) };
}

export function changeVocabularySession(input: VocabularySessionOperation, now = new Date()): VocabularySessionResponse {
  const database = getDatabase();
  ensureVocabularyTables(database);
  loadVocabularyCatalog(database);
  return database.transaction(() => {
    if (input.action === "start") {
      const latest = readVocabularySession(database);
      const existing = input.id ? readVocabularySession(database, input.id) : null;
      if (existing) {
        if (existing.id === latest?.id) return getVocabularySession();
        throw new VocabularySessionConflict("这个练习编号属于较早的一轮，请刷新页面。");
      }
      const study = requireVocabularyStudyVersion(input.restoreVersion, now, database);
      if (latest?.status === "active") throw new VocabularySessionConflict("已有进行中的练习，请先继续或结束本轮。");
      loadVocabularyCatalog(database);
      const courseId = input.courseId === undefined ? study.activeCourseId : input.courseId;
      if (courseId && !database.prepare("SELECT 1 FROM vocabulary_courses WHERE id=?").get(courseId) && input.courseId !== undefined)
        throw new VocabularySessionConflict("课程已不存在，请刷新课程列表。");
      if (input.courseId !== undefined) selectVocabularyCourse(input.courseId, input.courseId === study.activeCourseId ? study.startRank : 1, database);
      const session: VocabularySession = { id: input.id ?? randomUUID(), revision: 1, status: "active",
        state: { mode: input.mode, courseId, current: null, skippedIds: [], reviewed: 0, learned: 0, supplementalReviewed: 0, lastSubmissionId: null },
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
    if (input.action === "next") {
      if (session.state.current) return getVocabularySession();
      loadVocabularyCatalog(database);
      const advanced = getVocabularyStudy(now, database);
      if (advanced.focus === "ielts-advanced" || readVocabularyTargetDefinitions(database).some(({ target }) => target.memberships.some((member) => member.courseId === advanced.activeCourseId))) {
        const current = selectVocabularyTargetCard(session, now, database);
        if (current) writeVocabularySession(database, { ...session, state: { ...session.state, courseId: advanced.activeCourseId, current } }, now);
        return getVocabularySession();
      }
      const isNew = (word: ReturnType<typeof listVocabularyEntries>[number]) => !word.learningStartedAt && !word.hasReviewHistory && word.repetitions <= 0;
      const definitions = readVocabularyTargetDefinitions(database).filter(({ entry, target }) => vocabularyTargetEligible(entry, target, advanced.focus ?? "general", database));
      const held = new Set(listVocabularyTargetStates(database).filter(state => state.wordId && !state.paused && [1, 2].includes(state.step)
        && definitions.some(({ target }) => target.id === state.targetId)
        && (session.state.mode !== "context" || state.dueAt && Date.parse(state.dueAt) > now.getTime())).map(state => state.wordId));
      const words = listVocabularyEntries().filter((word) => !held.has(word.id) && !session.state.skippedIds.includes(word.id) && !isVocabularyTermPaused(word.term, database));
      let word = words.filter((item) => !isNew(item) && Date.parse(item.dueAt) <= now.getTime())
        .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt) || a.id.localeCompare(b.id))[0];
      const settings = getVocabularyStudy(now, database);
      // A hand-selected sense can be learned alongside a legacy non-target course.
      // When none remains, continue the original course rather than replacing it.
      if (!word && settings.activeCourseId && morphologySelectedTargetRanks(database).size) {
        const selected = selectVocabularyTargetCard(session, now, database);
        if (selected) {
          writeVocabularySession(database, { ...session, state: { ...session.state, current: selected } }, now);
          return getVocabularySession();
        }
      }
      const catalogWords = new Set((database.prepare("SELECT word_id FROM vocabulary_catalog_links WHERE detached=0").all() as { word_id: string }[]).map((link) => link.word_id));
      if (!word && settings.activeCourseId) word = words.filter((item) => isNew(item) && !catalogWords.has(item.id) && Boolean(vocabularyRecallCue(item).title))
        .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt) || a.id.localeCompare(b.id))[0];
      // null pauses every new card, including personal captures; learned due cards continue.
      if (!word && settings.activeCourseId) {
        const existingWords = new Map(listVocabularyEntries().map((item) => [item.id, item]));
        for (const entry of listVocabularyCatalogEntries(settings.activeCourseId, database).filter((entry) => entry.rank >= settings.startRank)) {
          if (!isVocabularyCatalogEntryLearnable(entry) || isVocabularyTermPaused(entry.term, database)) continue;
          const link = database.prepare("SELECT word_id,detached FROM vocabulary_catalog_links WHERE entry_id=?").get(entry.id) as { word_id: string; detached: number } | undefined;
          if (link?.detached || (link?.word_id && existingWords.has(link.word_id) && !isNew(existingWords.get(link.word_id)!))) continue;
          const candidate = materializeVocabularyCatalogEntry(entry, database);
          if (candidate && !session.state.skippedIds.includes(candidate.id) && isNew(candidate)) { word = candidate; break; }
        }
      }
      if (!word) return getVocabularySession();
      const exercise = vocabularyExerciseForWord(word, settings.activeCourseId, database);
      if (exercise?.target) {
        const current = selectVocabularyTargetCard(session, now, database);
        if (current) writeVocabularySession(database, { ...session, state: { ...session.state, courseId: settings.activeCourseId, current } }, now);
        return getVocabularySession();
      }
      const updated: VocabularySession = { ...session, state: { ...session.state, courseId: settings.activeCourseId,
        current: { wordId: word.id, wordVersion: word.reviewVersion, phase: isNew(word) ? "learn" : "front", answer: "",
          gaveUp: false, confirmedTypo: false, audioPlayed: false, requestedRating: null, ratingSource: "automatic", exercise, startedAt: now.toISOString() } } };
      updated.state.current!.supplemental = false;
      updated.state.current!.canSupplement = !isNew(word) && session.state.mode === "context"
        && Boolean(supplementalVocabularyExerciseForWord(word, exercise, settings.activeCourseId, database));
      writeVocabularySession(database, updated, now);
      return getVocabularySession();
    }
    const words = listVocabularyEntries();
    if (input.state.courseId !== undefined && input.state.courseId !== session.state.courseId)
      throw new VocabularySessionConflict("课程已切换，请刷新会话后继续。");
    const { current } = input.state;
    if (input.state.mode !== session.state.mode && (current || (session.state.current && !input.state.skippedIds.includes(session.state.current.wordId))))
      throw new VocabularySessionConflict("切换方式时请暂缓原词，再练习下一张卡片。");
    if (current) {
      const word = words.find((item) => item.id === current.wordId);
      if (!word) throw new VocabularySessionConflict("词条已不存在，请刷新队列。");
      if (word.reviewVersion !== current.wordVersion) throw new VocabularyReviewConflict(word);
      const previous = session.state.current;
      for (const key of ["target", "purpose", "targetStateVersion", "consolidation", "restoreVersion", "policyVersion"] as const)
        if (JSON.stringify(current[key]) !== JSON.stringify(previous?.[key])) throw new VocabularySessionConflict("用法或练习用途只能由服务端选择，请同步当前卡片。");
      const isNew = !word.learningStartedAt && !word.hasReviewHistory && word.repetitions <= 0;
      if (current.purpose !== "learn-target" && isNew !== (current.phase === "learn")) throw new VocabularySessionConflict("词卡学习状态已变化，请刷新队列。");
      if (!isVocabularyTargetCardCurrent(current, word, database)) throw new VocabularySessionConflict("用法、暂停状态或学习版本已变化，请同步后继续。");
      if (Boolean(current.supplemental) !== Boolean(previous?.supplemental) || Boolean(current.canSupplement) !== Boolean(previous?.canSupplement))
        throw new VocabularySessionConflict("追加练习只能由服务端选择，请同步当前题卡。");
      if (current.supplemental && (!previous || previous.wordId !== current.wordId || input.state.mode !== "context" || !current.exercise || isNew || current.canSupplement))
        throw new VocabularySessionConflict("追加练习状态不正确，请同步当前题卡。");
      if (!isNew && current.purpose !== "learn-target" && !current.supplemental && Date.parse(word.dueAt) > now.getTime()) throw new VocabularySessionConflict("这个词尚未到期，请按最新队列继续。");
      if (previous?.exercise && previous.wordId !== current.wordId)
        throw new VocabularySessionConflict("请暂缓当前题，再由服务端选取下一张卡片。");
      if (JSON.stringify(current.exercise ?? null) !== JSON.stringify(previous?.exercise ?? null))
        throw new VocabularySessionConflict("题面版本已变化，请刷新后继续原题。");
      if (!isVocabularyExerciseCurrent(current.exercise, database)) throw new VocabularySessionConflict("题目已修改或下架，原答案尚未评分；请同步最新题卡。");
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
