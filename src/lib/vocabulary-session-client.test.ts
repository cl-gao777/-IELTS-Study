import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VocabularyEntry } from "./vocabulary";
import type { VocabularyReviewRecord, VocabularySession } from "./vocabulary-session";
import { VocabularySessionClient, type VocabularyTransport } from "./vocabulary-session-client";
import { canRecoverVocabularyDraft, parseVocabularyRecovery, vocabularyRecoveryKey } from "./vocabulary-recovery";
import { isVocabularyNew, vocabularyReviewQueue } from "./vocabulary-practice";
import type { VocabularyExerciseSnapshot } from "./vocabulary-course";

const now = Date.parse("2026-10-06T09:00:00.000Z");
function word(id: string, fresh = false): VocabularyEntry {
  return { id, term: id, dueAt: new Date(now - 1000).toISOString(), reviewVersion: 1,
    hasReviewHistory: !fresh, repetitions: fresh ? 0 : 1, learningStartedAt: null,
    meaningZh: "测试释义" } as VocabularyEntry;
}
function contextExercise(term: string, alternate = false): VocabularyExerciseSnapshot {
  const sentence = alternate ? `We discussed the ${term} after class.` : `The report described the ${term} clearly.`;
  const targetStart = sentence.indexOf(term);
  return { entryId: term, courseId: "academic", id: `${term}-context-${alternate ? 2 : 1}`, version: 1,
    status: "published", sentence, targetStart, targetEnd: targetStart + term.length, targetSurface: term,
    acceptedAnswers: [term], meaningZh: "测试释义", source: "原创学习例句" };
}
function fixture(words = [word("economy"), word("evidence")]) {
  let session: VocabularySession = { id: "00000000-0000-4000-8000-000000000001", revision: 1, status: "active",
    startedAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
    state: { mode: "recall", courseId: null, current: null, skippedIds: [], reviewed: 0, learned: 0, supplementalReviewed: 0, lastSubmissionId: null } };
  const storage = new Map<string, string>();
  const cache = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } };
  const submissions = new Map<string, VocabularyReviewRecord>();
  const calls: { url: string; body?: Record<string, unknown> }[] = [];
  let gradeFailure: "before" | "after" | null = null;
  let holdCheckpoint: ((failure: () => void) => void) | null = null;
  let actionFailure: "start" | "end" | "next" | null = null;
  let failingReads = 0;
  let holdGrade: ((release: () => void) => void) | null = null;
  let holdBeforeCheckpoint: ((release: () => void) => void) | null = null;
  let contextCards = false;
  const transport: VocabularyTransport = async (url, body) => {
    const data = body as Record<string, unknown> | undefined;
    calls.push({ url, body: data });
    if (!data && failingReads > 0) { failingReads--; throw new TypeError("read unavailable"); }
    const conflict = () => ({ ok: false, status: 409, payload: structuredClone({ session, words, error: "本轮状态已更新" }) });
    if (data?.action === "start") {
      if (data.id !== session.id) {
        if (session.status === "active") return conflict();
        session = { ...session, id: data.id as string, status: "active", revision: 1,
          state: { mode: data.mode as "recall", courseId: (data.courseId as string | null) ?? null, current: null, skippedIds: [], reviewed: 0, learned: 0, supplementalReviewed: 0, lastSubmissionId: null } };
      }
    }
    else if (data?.action === "next") {
      if (data.id !== session.id || data.expectedRevision !== session.revision || session.status !== "active") return conflict();
      if (!session.state.current) {
        const next = vocabularyReviewQueue(words, Date.now(), new Set(session.state.skippedIds))[0];
        if (next) session = { ...session, revision: session.revision + 1, state: { ...session.state, current: {
          wordId: next.id, wordVersion: next.reviewVersion, phase: isVocabularyNew(next) ? "learn" : "front",
          answer: "", gaveUp: false, confirmedTypo: false, audioPlayed: false,
          exercise: contextCards ? contextExercise(next.term) : null, supplemental: false, canSupplement: contextCards && session.state.mode === "context",
          requestedRating: null, ratingSource: "automatic", startedAt: new Date(Date.now()).toISOString(),
        } } };
      }
    }
    else if (data?.action === "checkpoint") {
      if (holdBeforeCheckpoint) { const hold = holdBeforeCheckpoint; holdBeforeCheckpoint = null; await new Promise<void>((resolve) => hold(resolve)); }
      if (data.id !== session.id || data.expectedRevision !== session.revision || session.status !== "active") return conflict();
      const next = data.state as VocabularySession["state"];
      if (session.state.current?.phase === "revealed" && next.current?.wordId === session.state.current.wordId
        && next.current.answer !== session.state.current.answer) return conflict();
      session = { ...session, revision: session.revision + 1, state: { ...session.state, ...(data.state as object) } };
      if (holdCheckpoint) {
        const hold = holdCheckpoint; holdCheckpoint = null;
        await new Promise<void>((_resolve, reject) => hold(() => reject(new TypeError("lost checkpoint response"))));
      }
    } else if (data?.action === "end") {
      if (session.id !== data.id) return conflict();
      if (session.status !== "ended") {
        if (session.revision !== data.expectedRevision) return conflict();
        session = { ...session, status: "ended", revision: session.revision + 1, state: { ...session.state, current: null } };
      }
    }
    else if (url.endsWith("/learn") && !words[0].learningStartedAt) {
      words = words.map((item, at) => at ? item : { ...item, reviewVersion: item.reviewVersion + 1, learningStartedAt: new Date(now).toISOString(), dueAt: new Date(now + 60_000).toISOString() });
      session = { ...session, revision: session.revision + 1, state: { ...session.state, learned: session.state.learned + 1, current: null } };
    } else if (data && url.endsWith("/review")) {
      if (gradeFailure === "before") { gradeFailure = null; throw new TypeError("network down"); }
      const submissionId = data.submissionId as string;
      if (!submissions.has(submissionId)) {
        if (data.sessionId !== session.id || data.expectedSessionRevision !== session.revision || session.status !== "active") return conflict();
        const id = session.state.current!.wordId;
        const graded = words.find((item) => item.id === id)!;
        if (data.expectedVersion !== graded.reviewVersion || session.state.current!.phase !== "revealed") return conflict();
        const current = session.state.current!;
        const supplemental = Boolean(current.supplemental);
        if (data.continueWithPractice && !current.canSupplement) return conflict();
        const review = { id: submissions.size + 1, submissionId, sessionId: session.id, wordId: id,
          wordVersion: graded.reviewVersion, mode: data.mode, userAnswer: data.userAnswer, correct: true,
          termSnapshot: graded.term, requestedRating: data.rating, effectiveRating: data.rating, decisionReason: "correct_answer",
          confirmedTypo: Boolean(data.confirmedTypo), gaveUp: Boolean(data.gaveUp), reviewedAt: new Date(now).toISOString(),
          nextDueAt: supplemental ? graded.dueAt : new Date(now + 86400_000).toISOString(), supplemental } as VocabularyReviewRecord;
        submissions.set(submissionId, review);
        if (!supplemental) words = words.map((item) => item.id === id ? { ...item, reviewVersion: item.reviewVersion + 1, dueAt: review.nextDueAt } : item);
        const updatedWord = words.find((item) => item.id === id)!;
        const auxiliary = data.continueWithPractice ? { ...current, wordVersion: updatedWord.reviewVersion, phase: "front" as const,
          answer: "", gaveUp: false, confirmedTypo: false, audioPlayed: false, exercise: contextExercise(graded.term, true),
          requestedRating: null, ratingSource: "automatic" as const, supplemental: true, canSupplement: false,
          startedAt: new Date(Date.now()).toISOString() } : null;
        session = { ...session, revision: session.revision + 1, state: { ...session.state, current: auxiliary,
          reviewed: session.state.reviewed + Number(!supplemental), supplementalReviewed: (session.state.supplementalReviewed ?? 0) + Number(supplemental), lastSubmissionId: submissionId } };
      }
      if (gradeFailure === "after") { gradeFailure = null; throw new TypeError("response lost"); }
      const review = submissions.get(submissionId)!;
      const payload = structuredClone({ session, words, review, word: words.find((item) => item.id === review.wordId) });
      if (holdGrade) { const hold = holdGrade; holdGrade = null; await new Promise<void>((resolve) => hold(resolve)); }
      return { ok: true, status: 200, payload };
    }
    if (actionFailure && data?.action === actionFailure) { actionFailure = null; throw new TypeError("action response lost"); }
    const queryId = new URL(url, "http://localhost").searchParams.get("submissionId");
    return { ok: true, status: 200, payload: structuredClone({ session, words, ...(url.endsWith("/learn") ? { word: words[0] } : {}), ...(queryId ? { submission: submissions.get(queryId) ?? null } : {}) }) };
  };
  const clients: VocabularySessionClient[] = [];
  const client = (send: VocabularyTransport = transport) => { const value = new VocabularySessionClient(words, now, send); clients.push(value); return value; };
  return { client, transport, cache, calls, submissions, clients, words: () => words, server: () => session,
    failGrade: (when: "before" | "after") => { gradeFailure = when; },
    failReads: (count = 1) => { failingReads = count; },
    enableContext: () => { contextCards = true; session.state.mode = "context"; },
    failAction: (action: "start" | "end" | "next", reads = 0) => { actionFailure = action; failingReads = reads; },
    holdGrade: (callback: (release: () => void) => void) => { holdGrade = callback; },
    holdBeforeCheckpoint: (callback: (release: () => void) => void) => { holdBeforeCheckpoint = callback; },
    restore: (saved: VocabularySession, savedWords: VocabularyEntry[]) => { session = { ...structuredClone(saved), revision: Math.max(saved.revision, session.revision) + 2 }; words = structuredClone(savedWords); },
    hold: (callback: (fail: () => void) => void) => { holdCheckpoint = callback; } };
}
const input = { rating: "good" as const, ratingSource: "self" as const, mode: "recall" as const, userAnswer: "economy", confirmedTypo: false, gaveUp: false, durationSeconds: 3 };
const fixtures: ReturnType<typeof fixture>[] = [];
function setup(words?: VocabularyEntry[]) { const value = fixture(words); fixtures.push(value); return value; }
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { for (const value of fixtures.splice(0)) for (const client of value.clients) client.dispose(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("durable vocabulary practice client", () => {
  it("draws only through server next and recovers a lost assignment response without redrawing", async () => {
    const f = setup(); f.failAction("next"); const client = f.client(); await client.initialize(f.cache);
    expect(client.getSnapshot().session!.state.current?.wordId).toBe("economy");
    expect(f.calls.filter((call) => call.body?.action === "next")).toHaveLength(1);
    expect(f.calls.filter((call) => call.body?.action === "checkpoint")).toHaveLength(0);
    const fixed = structuredClone(client.getSnapshot().session!.state.current);
    for (let second = 1; second <= 60; second++) client.tick(now + second * 1000);
    expect(client.getSnapshot().session!.state.current).toEqual(fixed);
    expect(f.calls.filter((call) => call.body?.action === "next")).toHaveLength(1);
    expect(f.submissions.size).toBe(0);
  });
  it("course management ends the round and remains a management view on refresh", async () => {
    const f = setup(); const client = f.client(); await client.initialize(f.cache);
    await client.enterManagement("courses"); expect(f.server().status).toBe("ended");
    const resumed = f.client(); await resumed.initialize(f.cache);
    expect(resumed.getSnapshot().view).toBe("courses"); expect(resumed.getSnapshot().mode).toBe("context");
    expect(f.submissions.size).toBe(0);
  });
  it.each(["courses", "library"] as const)("keeps %s mounted throughout a background refresh and displays server synchronization notices", async (view) => {
    const f = setup(); let holdRead = false; let releaseRead!: () => void;
    const client = f.client(async (url, body) => {
      if (!body && holdRead) await new Promise<void>((resolve) => { releaseRead = resolve; });
      const reply = await f.transport(url, body);
      return holdRead ? { ...reply, payload: { ...reply.payload, error: "旧题资料已同步，请从最新内容继续。" } } : reply;
    });
    await client.initialize(f.cache); await client.enterManagement(view);
    const observed: { ready: boolean; view: string }[] = [];
    const unsubscribe = client.subscribe(() => { const snapshot = client.getSnapshot(); observed.push({ ready: snapshot.ready, view: snapshot.view }); });
    holdRead = true; const refreshing = client.refresh();
    expect(client.getSnapshot()).toMatchObject({ ready: true, busy: true, view });
    releaseRead(); await refreshing;
    expect(observed.every((snapshot) => snapshot.ready && snapshot.view === view)).toBe(true);
    expect(client.getSnapshot()).toMatchObject({ ready: true, busy: false, view, message: "旧题资料已同步，请从最新内容继续。" });
    expect(f.submissions.size).toBe(0); unsubscribe();
  });
  it("retains the visible management state when a background read fails", async () => {
    const f = setup(); let unavailable = false;
    const client = f.client(async (url, body) => {
      if (!body && unavailable) throw new TypeError("offline");
      return f.transport(url, body);
    });
    await client.initialize(f.cache); await client.enterManagement("courses");
    const before = client.getSnapshot(); const readiness: boolean[] = [];
    const unsubscribe = client.subscribe(() => readiness.push(client.getSnapshot().ready));
    unavailable = true; await client.refresh();
    expect(readiness.every(Boolean)).toBe(true);
    expect(client.getSnapshot()).toMatchObject({ ready: true, busy: false, view: "courses" });
    expect(client.getSnapshot().session).toEqual(before.session); expect(client.getSnapshot().words).toEqual(before.words);
    expect(client.getSnapshot().message).toContain("加载失败"); unsubscribe();
  });
  it("retains unsaved live typing during a background read without browser storage", async () => {
    const f = setup(); const client = f.client(); await client.initialize();
    client.changeDraft({ answer: "econmoy", confirmedTypo: false });
    await client.refresh();
    expect(client.getSnapshot().session!.state.current).toMatchObject({ wordId: "economy", answer: "econmoy", phase: "front" });
    await client.flush(); expect(f.server().state.current!.answer).toBe("econmoy"); expect(f.submissions.size).toBe(0);
  });
  it("still blocks first loading and backup reset until the authoritative record is read", async () => {
    const f = setup(); let holdRead = true; let releaseRead!: () => void;
    const client = f.client(async (url, body) => {
      if (!body && holdRead) await new Promise<void>((resolve) => { releaseRead = resolve; });
      return f.transport(url, body);
    });
    const initializing = client.initialize(f.cache);
    expect(client.getSnapshot()).toMatchObject({ ready: false, busy: true });
    holdRead = false; releaseRead(); await initializing;
    expect(client.getSnapshot().ready).toBe(true);
    const saved = structuredClone(f.server()); f.restore(saved, f.words()); holdRead = true;
    client.resetAfterRestore(); expect(client.getSnapshot()).toMatchObject({ ready: false, busy: true, session: null });
    holdRead = false; releaseRead(); await vi.waitFor(() => expect(client.getSnapshot().ready).toBe(true));
    expect(client.getSnapshot().session!.revision).toBe(f.server().revision); expect(f.submissions.size).toBe(0);
  });
  it("an explicit synchronization defers a stale word rather than grading its old version", async () => {
    const f = setup(); const client = f.client(); await client.initialize(f.cache); f.words()[0].reviewVersion++;
    await client.refresh();
    expect(client.getSnapshot().session!.state.skippedIds).toContain("economy");
    expect(client.getSnapshot().session!.state.current?.wordId).toBe("evidence"); expect(f.submissions.size).toBe(0);
  });
  it("keeps stale unsubmitted input separately through reload instead of transplanting it into the refreshed card", async () => {
    const f = setup(); f.enableContext(); const client = f.client(); await client.initialize(f.cache);
    client.changeDraft({ answer: "old raw answer" });
    const frozen = structuredClone(client.getSnapshot().session!.state.current!);
    f.words()[0].reviewVersion++;
    await client.refresh();
    expect(client.getSnapshot().conflicted).toMatchObject({ mode: "context", card: frozen });
    expect(client.getSnapshot().session!.state.current).toMatchObject({ wordId: "evidence", answer: "" });
    expect(f.submissions.size).toBe(0);
    client.dispose(); const reopened = f.client(); await reopened.initialize(f.cache);
    expect(reopened.getSnapshot().conflicted?.card.answer).toBe("old raw answer");
    expect(reopened.getSnapshot().conflicted?.card.exercise).toEqual(frozen.exercise);
    reopened.clearConflicted();
    expect(parseVocabularyRecovery(f.cache.getItem(vocabularyRecoveryKey))!.conflicted).toBeNull();
  });
  it("retains a legacy draft when a private course upgrade ends its round without changing the word version", async () => {
    const f = setup(); f.enableContext(); const client = f.client(); await client.initialize(f.cache);
    client.changeDraft({ answer: "legacy input not checkpointed" });
    const frozen = structuredClone(client.getSnapshot().session!.state.current!);
    client.dispose();
    const authoritative = f.server(); authoritative.status = "ended"; authoritative.revision += 2;
    const reopened = f.client(); await reopened.initialize(f.cache);
    expect(reopened.getSnapshot().session?.status).toBe("ended");
    expect(reopened.getSnapshot().conflicted).toMatchObject({ mode: "context", card: frozen });
    expect(parseVocabularyRecovery(f.cache.getItem(vocabularyRecoveryKey))!.conflicted?.card.answer).toBe("legacy input not checkpointed");
    expect(f.calls.filter((call) => call.url.endsWith("/review"))).toHaveLength(0);
  });
  it("makes a retired SQLite draft visible without reviving it when browser recovery is absent", async () => {
    const f = setup(); const first = f.client(); await first.initialize(f.cache);
    first.changeDraft({ answer: "server checkpoint retained" }); await first.flush(); first.dispose();
    const authoritative = f.server(); authoritative.status = "ended"; authoritative.revision += 2;
    f.cache.removeItem(vocabularyRecoveryKey);
    const reopened = f.client(); await reopened.initialize(f.cache);
    expect(reopened.getSnapshot().conflicted?.card.answer).toBe("server checkpoint retained");
    expect(reopened.getSnapshot().session?.status).toBe("ended");
    expect(f.calls.filter((call) => call.url.endsWith("/review"))).toHaveLength(0);
  });
  it("restores unsubmitted text, reveal and typo confirmation without grading", async () => {
    const f = setup(); const first = f.client(); await first.initialize(f.cache); await first.flush();
    first.changeDraft({ answer: "econmoy", phase: "revealed", confirmedTypo: true, requestedRating: "hard", ratingSource: "self" }); first.dispose();
    const resumed = f.client(); await resumed.initialize(f.cache);
    expect(resumed.getSnapshot().session!.state.current).toMatchObject({ answer: "econmoy", phase: "revealed", confirmedTypo: true, requestedRating: "hard", ratingSource: "self" });
    expect(f.submissions.size).toBe(0);
    await resumed.flush(); expect(f.server().state.current!.answer).toBe("econmoy");
  });
  it("changing modes defers a revealed word, and a single remaining card is not recycled", async () => {
    const f = setup([word("economy")]); const client = f.client(); await client.initialize(f.cache);
    client.changeDraft({ answer: "economy", phase: "revealed" });
    await client.changeMode("recognition"); client.tick(now + 60_000);
    expect(client.getSnapshot().session!.state).toMatchObject({ mode: "recognition", current: null, skippedIds: ["economy"], reviewed: 0 });
    expect(f.submissions.size).toBe(0);
  });
  it("library management ends the round and returning cannot automatically resume it", async () => {
    const f = setup(); const client = f.client(); await client.initialize(f.cache);
    await client.enterLibrary(); expect(f.server().status).toBe("ended");
    const resumed = f.client(); await resumed.initialize(f.cache);
    expect(resumed.getSnapshot().view).toBe("library");
    resumed.returnToReview(); expect(resumed.getSnapshot().session!.status).toBe("ended");
    await resumed.startRound(); expect(resumed.getSnapshot().session!.status).toBe("active");
    expect(f.submissions.size).toBe(0);
  });
  it("a lost grading response is reconciled read-only and never graded twice", async () => {
    const f = setup(); const client = f.client(); await client.initialize(f.cache);
    client.changeDraft({ answer: "economy", phase: "revealed" }); f.failGrade("after");
    await client.reviewWord(f.words()[0], input);
    expect(f.submissions.size).toBe(1); expect(client.getSnapshot().pending).toBeNull();
    expect(client.getSnapshot().session!.state.reviewed).toBe(1);
    expect(f.calls.filter((call) => call.url.endsWith("/review"))).toHaveLength(1);
    const reopened = f.client(); await reopened.initialize(f.cache);
    expect(reopened.getSnapshot().session!.state.reviewed).toBe(1);
    expect(f.calls.filter((call) => call.url.endsWith("/review"))).toHaveLength(1);
  });
  it("an unsaved grading request keeps the answer and retries the exact original submission", async () => {
    const f = setup(); const client = f.client(); await client.initialize(f.cache);
    client.changeDraft({ answer: "economy", phase: "revealed" }); f.failGrade("before");
    await client.reviewWord(f.words()[0], input);
    expect(f.submissions.size).toBe(0); expect(client.getSnapshot().session!.state.current!.answer).toBe("economy");
    const submissionId = client.getSnapshot().pending!.input.submissionId;
    await client.retryReview(); expect(f.submissions.size).toBe(1);
    const requests = f.calls.filter((call) => call.url.endsWith("/review"));
    expect(requests.map((call) => call.body!.submissionId)).toEqual([submissionId, submissionId]);
  });
  it("does not resend an unresolved submission when its read-only verification fails", async () => {
    const f = setup(); const client = f.client(); await client.initialize(f.cache);
    client.changeDraft({ answer: "economy", phase: "revealed" }); f.failGrade("before");
    await client.reviewWord(f.words()[0], input);
    const submissionId = client.getSnapshot().pending!.input.submissionId;
    f.failReads(); await client.retryReview();
    expect(f.calls.filter((call) => call.url.endsWith("/review"))).toHaveLength(1);
    expect(client.getSnapshot().pending!.input.submissionId).toBe(submissionId);
    expect(client.getSnapshot().message).toContain("不会自动重新提交");
    await client.retryReview();
    expect(f.submissions.size).toBe(1);
    expect(f.calls.filter((call) => call.url.endsWith("/review")).map((call) => call.body!.submissionId)).toEqual([submissionId, submissionId]);
  });
  it("saves the scheduled grade once before a same-word auxiliary context that leaves FSRS unchanged", async () => {
    const f = setup(); f.enableContext(); const client = f.client(); await client.initialize(f.cache);
    const firstExercise = client.getSnapshot().session!.state.current!.exercise!;
    client.changeDraft({ answer: "economy", phase: "revealed" });
    await client.reviewWord(f.words()[0], { ...input, mode: "context", continueWithPractice: true });
    const scheduledWord = structuredClone(client.getSnapshot().words[0]);
    const current = client.getSnapshot().session!.state.current!;
    expect(current).toMatchObject({ wordId: "economy", wordVersion: scheduledWord.reviewVersion, phase: "front", answer: "", supplemental: true, canSupplement: false });
    expect(current.exercise?.id).not.toBe(firstExercise.id);
    expect(client.getSnapshot().session!.state).toMatchObject({ reviewed: 1, supplementalReviewed: 0 });
    expect(f.calls.filter((call) => call.body?.action === "next")).toHaveLength(1);
    client.changeDraft({ answer: "economy", phase: "revealed" });
    await client.reviewWord(scheduledWord, { ...input, mode: "context", continueWithPractice: false });
    expect(client.getSnapshot().words[0]).toEqual(scheduledWord);
    expect(client.getSnapshot().session!.state).toMatchObject({ reviewed: 1, supplementalReviewed: 1 });
    expect([...f.submissions.values()].map((record) => record.supplemental)).toEqual([false, true]);
    expect(client.getSnapshot().message).toBe("追加练习已保存，复习计划保持不变。");
  });
  it("restores the exact auxiliary exercise, input, reveal and typo state without a new grade", async () => {
    const f = setup(); f.enableContext(); const client = f.client(); await client.initialize(f.cache);
    client.changeDraft({ answer: "economy", phase: "revealed" });
    await client.reviewWord(f.words()[0], { ...input, mode: "context", continueWithPractice: true });
    client.changeDraft({ answer: "econmoy", phase: "revealed", confirmedTypo: true });
    const expected = structuredClone(client.getSnapshot().session!.state.current);
    client.dispose();
    const restored = f.client(); await restored.initialize(f.cache);
    expect(restored.getSnapshot().session!.state.current).toEqual(expected);
    expect(restored.getSnapshot().session!.state).toMatchObject({ reviewed: 1, supplementalReviewed: 0 });
    expect(f.submissions.size).toBe(1);
  });
  it("reconciles lost scheduled-to-auxiliary and auxiliary save responses through their original ledger IDs", async () => {
    const f = setup(); f.enableContext(); const client = f.client(); await client.initialize(f.cache);
    client.changeDraft({ answer: "economy", phase: "revealed" }); f.failGrade("after"); f.failReads();
    await client.reviewWord(f.words()[0], { ...input, mode: "context", continueWithPractice: true });
    expect(client.getSnapshot().pending?.input.continueWithPractice).toBe(true);
    await client.retryReview();
    expect(client.getSnapshot().session!.state.current?.supplemental).toBe(true);
    expect(f.calls.filter((call) => call.url.endsWith("/review"))).toHaveLength(1);
    client.changeDraft({ answer: "economy", phase: "revealed" }); f.failGrade("after"); f.failReads();
    await client.reviewWord(client.getSnapshot().words[0], { ...input, mode: "context", continueWithPractice: false });
    expect(client.getSnapshot().pending?.supplemental).toBe(true);
    expect(client.getSnapshot().message).toContain("追加练习");
    client.dispose(); const restored = f.client(); await restored.initialize(f.cache);
    expect(restored.getSnapshot().pending).toBeNull();
    expect(restored.getSnapshot().session!.state).toMatchObject({ reviewed: 1, supplementalReviewed: 1 });
    expect(f.calls.filter((call) => call.url.endsWith("/review"))).toHaveLength(2);
    expect(restored.getSnapshot().message).toContain("上次追加练习已保存");
  });
  it("keeps an unsaved auxiliary result for a verified retry with the same submission ID", async () => {
    const f = setup(); f.enableContext(); const client = f.client(); await client.initialize(f.cache);
    client.changeDraft({ answer: "economy", phase: "revealed" });
    await client.reviewWord(f.words()[0], { ...input, mode: "context", continueWithPractice: true });
    const scheduledWord = structuredClone(client.getSnapshot().words[0]);
    client.changeDraft({ answer: "econmoy", phase: "revealed", confirmedTypo: true }); f.failGrade("before");
    await client.reviewWord(scheduledWord, { ...input, mode: "context", userAnswer: "econmoy", confirmedTypo: true, continueWithPractice: false });
    const pending = client.getSnapshot().pending!;
    expect(pending.supplemental).toBe(true);
    client.dispose(); const restored = f.client(); await restored.initialize(f.cache);
    expect(restored.getSnapshot().pending).toEqual(pending);
    expect(restored.getSnapshot().message).toContain("上次追加练习尚未保存");
    await restored.retryReview();
    expect(f.calls.filter((call) => call.url.endsWith("/review")).slice(1).map((call) => call.body!.submissionId)).toEqual([pending.input.submissionId, pending.input.submissionId]);
    expect(restored.getSnapshot().words[0]).toEqual(scheduledWord);
    expect(restored.getSnapshot().session!.state).toMatchObject({ reviewed: 1, supplementalReviewed: 1 });
  });
  it("switching away from auxiliary practice defers its word and never automatically repeats it", async () => {
    const f = setup([word("economy")]); f.enableContext(); const client = f.client(); await client.initialize(f.cache);
    client.changeDraft({ answer: "economy", phase: "revealed" });
    await client.reviewWord(f.words()[0], { ...input, mode: "context", continueWithPractice: true });
    const scheduledWord = structuredClone(client.getSnapshot().words[0]);
    client.changeDraft({ answer: "unsubmitted" }); await client.changeMode("recall");
    expect(client.getSnapshot().session!.state).toMatchObject({ current: null, reviewed: 1, supplementalReviewed: 0, skippedIds: ["economy"] });
    expect(f.submissions.size).toBe(1);
    expect(client.getSnapshot().words[0]).toEqual(scheduledWord);
  });
  it("learning a new word schedules first recall, without a rating, exactly when due", async () => {
    const f = setup([word("economy", true)]); const client = f.client(); await client.initialize(f.cache);
    expect(client.getSnapshot().session!.state.current!.phase).toBe("learn");
    await client.learnWord(f.words()[0]); expect(f.submissions.size).toBe(0);
    expect(client.getSnapshot().session!.state).toMatchObject({ learned: 1, reviewed: 0, current: null });
    vi.setSystemTime(now + 59_000); client.tick(now + 59_000);
    await vi.waitFor(() => expect(client.getSnapshot().busy).toBe(false));
    expect(client.getSnapshot().session!.state.current).toBeNull();
    vi.setSystemTime(now + 60_000); client.tick(now + 60_000);
    await vi.waitFor(() => expect(client.getSnapshot().session!.state.current?.phase).toBe("front"));
  });
  it("recovers typing done during a checkpoint whose acknowledgement was lost", async () => {
    const f = setup(); const client = f.client(); await client.initialize(f.cache); await client.flush();
    client.changeDraft({ answer: "eco" });
    let rejectCheckpoint!: () => void;
    f.hold((reject) => { rejectCheckpoint = reject; });
    const saving = client.flush().catch(() => undefined);
    await vi.waitFor(() => expect(rejectCheckpoint).toBeTypeOf("function"));
    client.changeDraft({ answer: "economy" }); client.dispose(); rejectCheckpoint(); await saving;
    expect(f.server().state.current!.answer).toBe("eco");
    const resumed = f.client(); await resumed.initialize(f.cache);
    expect(resumed.getSnapshot().session!.state.current!.answer).toBe("economy");
    await resumed.flush(); expect(f.server().state.current!.answer).toBe("economy");
  });
  it("does not overlay a local draft on a restored or edited server version", async () => {
    const f = setup(); const client = f.client(); await client.initialize(f.cache); await client.flush();
    client.changeDraft({ answer: "old" });
    const recovery = parseVocabularyRecovery(f.cache.getItem(vocabularyRecoveryKey))!;
    expect(canRecoverVocabularyDraft(recovery, { ...f.server(), revision: f.server().revision + 1 }, f.words())).toBe(false);
    expect(canRecoverVocabularyDraft(recovery, f.server(), f.words().map((item) => ({ ...item, reviewVersion: item.reviewVersion + 1 })))).toBe(false);
    expect(parseVocabularyRecovery("{broken")).toBeNull();
  });
  it("keeps later typing when a live checkpoint acknowledgement is lost and saving is retried", async () => {
    const f = setup(); const client = f.client(); await client.initialize(f.cache); await client.flush();
    client.changeDraft({ answer: "eco" }); let rejectCheckpoint!: () => void;
    f.hold((reject) => { rejectCheckpoint = reject; }); const saving = client.flush().catch(() => undefined);
    await vi.waitFor(() => expect(rejectCheckpoint).toBeTypeOf("function"));
    client.changeDraft({ answer: "economy" }); rejectCheckpoint(); await saving;
    expect(f.server().state.current!.answer).toBe("eco");
    await client.flush();
    expect(f.server().state.current!.answer).toBe("economy");
    expect(client.getSnapshot().session!.state.current!.answer).toBe("economy");
  });
  it("recovers a saved start response and retains the same start ID if verification also fails", async () => {
    const f = setup(); const client = f.client(); await client.initialize(f.cache); await client.enterLibrary();
    f.failAction("start", 1); await client.startRound();
    expect(f.server().status).toBe("active"); expect(client.getSnapshot().session!.status).toBe("ended");
    await client.startRound();
    expect(client.getSnapshot().session!.status).toBe("active");
    const attempts = f.calls.filter((call) => call.body?.action === "start");
    expect(attempts).toHaveLength(2); expect(attempts[0].body!.id).toBe(attempts[1].body!.id);
  });
  it("adopts a different active session after a stale start receives 409", async () => {
    const f = setup(); const client = f.client(); await client.initialize(f.cache); await client.enterLibrary();
    f.server().status = "active"; f.server().id = "00000000-0000-4000-8000-000000000002";
    await client.startRound(); expect(client.getSnapshot().session!.id).toBe(f.server().id);
    expect(client.getSnapshot().session!.status).toBe("active");
  });
  it("reconciles a lost end response and adopts an externally changed revision before retrying end", async () => {
    const f = setup(); const client = f.client(); await client.initialize(f.cache); await client.flush();
    f.server().revision++; await client.enterLibrary();
    expect(client.getSnapshot().view).toBe("review"); expect(client.getSnapshot().session!.revision).toBe(f.server().revision);
    f.failAction("end"); await client.enterLibrary();
    expect(client.getSnapshot().view).toBe("library"); expect(client.getSnapshot().session!.status).toBe("ended");
  });
  it("ignores a pre-restore grading response after the restored session has been loaded", async () => {
    const f = setup(); const client = f.client(); await client.initialize(f.cache); await client.flush();
    client.changeDraft({ answer: "economy", phase: "revealed" }); await client.flush();
    const saved = structuredClone(f.server()); const savedWords = structuredClone(f.words());
    let release!: () => void; f.holdGrade((resolve) => { release = resolve; });
    const grading = client.reviewWord(f.words()[0], input);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    f.restore(saved, savedWords); client.resetAfterRestore();
    await vi.waitFor(() => expect(client.getSnapshot().ready).toBe(true));
    const restored = structuredClone(client.getSnapshot().session);
    release(); await grading;
    expect(client.getSnapshot().session).toEqual(restored);
    expect(client.getSnapshot().session!.state.reviewed).toBe(0);
    expect(client.getSnapshot().words[0].reviewVersion).toBe(1);
  });
  it("does not confuse restore's two-revision jump with a lost checkpoint acknowledgement", async () => {
    const f = setup(); const client = f.client(); await client.initialize(f.cache); await client.flush();
    client.changeDraft({ answer: "eco" }); let rejectCheckpoint!: () => void;
    f.hold((reject) => { rejectCheckpoint = reject; }); const saving = client.flush().catch(() => undefined);
    await vi.waitFor(() => expect(rejectCheckpoint).toBeTypeOf("function"));
    client.changeDraft({ answer: "economy" }); client.dispose(); rejectCheckpoint(); await saving;
    const recovery = parseVocabularyRecovery(f.cache.getItem(vocabularyRecoveryKey))!;
    const backup = { ...structuredClone(f.server()), revision: recovery.attempted!.revision };
    f.restore(backup, f.words());
    expect(canRecoverVocabularyDraft(recovery, f.server(), f.words())).toBe(false);
    const reopened = f.client(); await reopened.initialize(f.cache);
    expect(reopened.getSnapshot().session!.state.current!.answer).toBe("eco");
  });
  it("retains an unresolved checkpoint identity when reload reads before the original commit", async () => {
    const f = setup(); const first = f.client(); await first.initialize(f.cache); await first.flush();
    first.changeDraft({ answer: "eco" }); let release!: () => void;
    f.holdBeforeCheckpoint((resolve) => { release = resolve; }); const writing = first.flush().catch(() => undefined);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    first.changeDraft({ answer: "economy" }); first.dispose();
    const resumed = f.client(); await resumed.initialize(f.cache);
    expect(resumed.getSnapshot().session!.state.current!.answer).toBe("economy");
    release(); await writing;
    expect(f.server().state.current!.answer).toBe("eco");
    await resumed.flush(); expect(f.server().state.current!.answer).toBe("economy");
  });
  it("does not let an old checkpoint failure dirty a restored draft or replace its message", async () => {
    const f = setup(); const client = f.client(); await client.initialize(f.cache); await client.flush();
    const saved = structuredClone(f.server()); const savedWords = structuredClone(f.words());
    client.changeDraft({ answer: "eco" }); let rejectCheckpoint!: () => void;
    f.hold((reject) => { rejectCheckpoint = reject; }); const saving = client.flush().catch(() => undefined);
    await vi.waitFor(() => expect(rejectCheckpoint).toBeTypeOf("function"));
    f.restore(saved, savedWords); client.resetAfterRestore(); await vi.waitFor(() => expect(client.getSnapshot().ready).toBe(true));
    const restored = structuredClone(client.getSnapshot()); rejectCheckpoint(); await saving;
    expect(client.getSnapshot()).toEqual(restored);
    expect(parseVocabularyRecovery(f.cache.getItem(vocabularyRecoveryKey))!.dirty).toBe(false);
  });
  it("adopts an edit conflict's latest word while preserving the caller's original edit version", async () => {
    const f = setup(); const client = f.client(); await client.initialize(f.cache); await client.enterLibrary();
    const editing = structuredClone(f.words()[0]); f.words()[0].reviewVersion++; f.words()[0].meaningZh = "另一页的释义";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ session: f.server(), words: f.words(), word: f.words()[0], error: "词条已更新" }), { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await client.saveWord({ term: editing.term, meaningZh: "本页的草稿" }, editing)).toBe(false);
    expect(client.getSnapshot().words[0].meaningZh).toBe("另一页的释义");
    expect(client.getSnapshot().message).toContain("重新打开");
    expect(await client.saveWord({ term: editing.term, meaningZh: "本页的草稿" }, editing)).toBe(false);
    expect(fetchMock.mock.calls).toHaveLength(2);
    for (const call of fetchMock.mock.calls) expect(JSON.parse(String((call as unknown as [string, RequestInit])[1].body)).expectedVersion).toBe(editing.reviewVersion);
  });
  it("does not mistake an unchanged-revision validation conflict for an acknowledged checkpoint", async () => {
    const f = setup(); const client = f.client(); await client.initialize(f.cache);
    client.changeDraft({ answer: "econmy", phase: "revealed" }); await client.flush();
    client.changeDraft({ answer: "economy" });
    await expect(client.flush()).rejects.toThrow("最新记录");
    expect(client.getSnapshot().session!.state.current!.answer).toBe("econmy");
    expect(f.submissions.size).toBe(0);
  });
});
