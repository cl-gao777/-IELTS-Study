import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VocabularyEntry } from "./vocabulary";
import type { VocabularyReviewRecord, VocabularySession } from "./vocabulary-session";
import { VocabularySessionClient, type VocabularyTransport } from "./vocabulary-session-client";
import { canRecoverVocabularyDraft, parseVocabularyRecovery, vocabularyRecoveryKey } from "./vocabulary-recovery";

const now = Date.parse("2026-10-06T09:00:00.000Z");
function word(id: string, fresh = false): VocabularyEntry {
  return { id, term: id, dueAt: new Date(now - 1000).toISOString(), reviewVersion: 1,
    hasReviewHistory: !fresh, repetitions: fresh ? 0 : 1, learningStartedAt: null,
    meaningZh: "测试释义" } as VocabularyEntry;
}
function fixture(words = [word("economy"), word("evidence")]) {
  let session: VocabularySession = { id: "00000000-0000-4000-8000-000000000001", revision: 1, status: "active",
    startedAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
    state: { mode: "recall", current: null, skippedIds: [], reviewed: 0, learned: 0, lastSubmissionId: null } };
  const storage = new Map<string, string>();
  const cache = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } };
  const submissions = new Map<string, VocabularyReviewRecord>();
  const calls: { url: string; body?: Record<string, unknown> }[] = [];
  let gradeFailure: "before" | "after" | null = null;
  let holdCheckpoint: ((failure: () => void) => void) | null = null;
  let actionFailure: "start" | "end" | null = null;
  let failingReads = 0;
  let holdGrade: ((release: () => void) => void) | null = null;
  let holdBeforeCheckpoint: ((release: () => void) => void) | null = null;
  const transport: VocabularyTransport = async (url, body) => {
    const data = body as Record<string, unknown> | undefined;
    calls.push({ url, body: data });
    if (!data && failingReads > 0) { failingReads--; throw new TypeError("read unavailable"); }
    const conflict = () => ({ ok: false, status: 409, payload: structuredClone({ session, words, error: "本轮状态已更新" }) });
    if (data?.action === "start") {
      if (data.id !== session.id) {
        if (session.status === "active") return conflict();
        session = { ...session, id: data.id as string, status: "active", revision: 1,
          state: { mode: data.mode as "recall", current: null, skippedIds: [], reviewed: 0, learned: 0, lastSubmissionId: null } };
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
        const review = { id: submissions.size + 1, submissionId, sessionId: session.id, wordId: id,
          wordVersion: graded.reviewVersion, mode: data.mode, userAnswer: data.userAnswer, correct: true,
          termSnapshot: graded.term, requestedRating: data.rating, effectiveRating: data.rating, decisionReason: "correct_answer",
          confirmedTypo: false, gaveUp: false, reviewedAt: new Date(now).toISOString(), nextDueAt: new Date(now + 86400_000).toISOString() } as VocabularyReviewRecord;
        submissions.set(submissionId, review);
        words = words.map((item) => item.id === id ? { ...item, reviewVersion: item.reviewVersion + 1, dueAt: review.nextDueAt } : item);
        session = { ...session, revision: session.revision + 1, state: { ...session.state, current: null, reviewed: session.state.reviewed + 1, lastSubmissionId: submissionId } };
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
  const client = () => { const value = new VocabularySessionClient(words, now, transport); clients.push(value); return value; };
  return { client, cache, calls, submissions, clients, words: () => words, server: () => session,
    failGrade: (when: "before" | "after") => { gradeFailure = when; },
    failAction: (action: "start" | "end", reads = 0) => { actionFailure = action; failingReads = reads; },
    holdGrade: (callback: (release: () => void) => void) => { holdGrade = callback; },
    holdBeforeCheckpoint: (callback: (release: () => void) => void) => { holdBeforeCheckpoint = callback; },
    restore: (saved: VocabularySession, savedWords: VocabularyEntry[]) => { session = { ...structuredClone(saved), revision: Math.max(saved.revision, session.revision) + 2 }; words = structuredClone(savedWords); },
    hold: (callback: (fail: () => void) => void) => { holdCheckpoint = callback; } };
}
const input = { rating: "good" as const, mode: "recall" as const, userAnswer: "economy", confirmedTypo: false, gaveUp: false, durationSeconds: 3 };
const fixtures: ReturnType<typeof fixture>[] = [];
function setup(words?: VocabularyEntry[]) { const value = fixture(words); fixtures.push(value); return value; }
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { for (const value of fixtures.splice(0)) for (const client of value.clients) client.dispose(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("durable vocabulary practice client", () => {
  it("restores unsubmitted text, reveal and typo confirmation without grading", async () => {
    const f = setup(); const first = f.client(); await first.initialize(f.cache); await first.flush();
    first.changeDraft({ answer: "econmoy", phase: "revealed", confirmedTypo: true }); first.dispose();
    const resumed = f.client(); await resumed.initialize(f.cache);
    expect(resumed.getSnapshot().session!.state.current).toMatchObject({ answer: "econmoy", phase: "revealed", confirmedTypo: true });
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
  it("learning a new word schedules first recall, without a rating, exactly when due", async () => {
    const f = setup([word("economy", true)]); const client = f.client(); await client.initialize(f.cache);
    expect(client.getSnapshot().session!.state.current!.phase).toBe("learn");
    await client.learnWord(f.words()[0]); expect(f.submissions.size).toBe(0);
    expect(client.getSnapshot().session!.state).toMatchObject({ learned: 1, reviewed: 0, current: null });
    client.tick(now + 59_999); expect(client.getSnapshot().session!.state.current).toBeNull();
    client.tick(now + 60_000); expect(client.getSnapshot().session!.state.current!.phase).toBe("front");
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
