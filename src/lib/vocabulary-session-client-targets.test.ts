import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VocabularySessionClient, type VocabularyTransport } from "./vocabulary-session-client";
import type { VocabularyEntry } from "./vocabulary";
import type { VocabularyCardDraft, VocabularySession } from "./vocabulary-session";
import type { VocabularyTargetSnapshot, VocabularyTargetState, VocabularyTermDisposition } from "./vocabulary-target";
import { parseVocabularyRecovery, vocabularyRecoveryKey } from "./vocabulary-recovery";

const now = Date.parse("2026-10-08T06:00:00.000Z");
const target: VocabularyTargetSnapshot = { id: "state-formal-verb", version: 2, status: "published", entryId: "state", term: "state", normalizedTerm: "state",
  courseId: "ielts-pdf-advanced:example", membershipVersion: 3, partOfSpeech: "verb", meaningZh: "正式陈述；明确说明", definitionEn: "to express information formally",
  ipa: "/steɪt/", headwordAnswers: [], level: "B2", levelEvidence: [], advancedReason: "描述报告或研究发现", source: "本地精选资料", sourcePdf: null };
function fixture() {
  let word = { id: "state-word", term: "state", reviewVersion: 12, dueAt: "2028-01-01T00:00:00.000Z", learningStartedAt: "2026-10-01T06:00:00.000Z",
    hasReviewHistory: true, repetitions: 8, intervalDays: 40, meaningZh: "状态", definitionEn: "a condition", partOfSpeech: "noun" } as VocabularyEntry;
  const card: VocabularyCardDraft = { wordId: word.id, wordVersion: 12, phase: "learn", answer: "", gaveUp: false, confirmedTypo: false, audioPlayed: false,
    requestedRating: null, ratingSource: "automatic", supplemental: false, canSupplement: false, startedAt: new Date(now).toISOString(),
    target, purpose: "learn-target", targetStateVersion: 0, restoreVersion: 4, policyVersion: 9,
    exercise: { entryId: target.entryId, courseId: target.courseId, id: "state-context-1", version: 5, status: "published",
      sentence: "The report will state the findings clearly.", targetStart: 16, targetEnd: 21, targetSurface: "state", acceptedAnswers: ["state"], meaningZh: target.meaningZh, source: "原创语境" } };
  let session: VocabularySession = { id: "10000000-0000-4000-8000-000000000001", revision: 1, status: "active", startedAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
    state: { mode: "context", courseId: target.courseId, current: card, skippedIds: [], reviewed: 0, learned: 0, supplementalReviewed: 0, lastSubmissionId: null } };
  let targetStates: VocabularyTargetState[] = []; let termDispositions: VocabularyTermDisposition[] = [];
  const operations = new Map<string, { operationId: string; action: string }>();
  const calls: { url: string; body?: Record<string, unknown> }[] = [];
  let operationFailure: "before" | "after" | null = null; let readFailures = 0;
  const storage = new Map<string, string>();
  const cache = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } };
  const payload = () => structuredClone({ session, words: [word], targets: [target], restoreVersion: 4, targetStates, termDispositions,
    queuePreview: { scheduledDue: 0, nextScheduledAt: null },
    targetCounts: { eligibleTargets: 1, pausedTargets: targetStates.filter((state) => state.paused).length, pausedTerms: termDispositions.filter((state) => state.paused).length,
      introducedTargets: targetStates.filter((state) => state.introducedAt).length, consolidationDue: 0, nextConsolidationAt: targetStates.find((state) => state.dueAt)?.dueAt ?? null } });
  const transport: VocabularyTransport = async (url, body) => {
    const data = body as Record<string, unknown> | undefined; calls.push({ url, body: data });
    if (!data && readFailures > 0) { readFailures--; throw new TypeError("read unavailable"); }
    if (data?.action === "checkpoint") {
      session = { ...session, revision: session.revision + 1, state: { ...session.state, ...(data.state as object) } };
    } else if (data?.action === "next") { /* A waiting consolidation has no immediate card. */ }
    else if (data && (url.endsWith("/learn") || url.endsWith("/targets"))) {
      if (operationFailure === "before") { operationFailure = null; throw new TypeError("request unsent"); }
      const operationId = String(data.operationId);
      if (!operations.has(operationId)) {
        if (data.restoreVersion !== 4) return { ok: false, status: 409, payload: { ...payload(), error: "数据已恢复" } };
        const action = url.endsWith("/learn") ? "learn-target" : String(data.action);
        const existing = targetStates.find((state) => state.targetId === target.id);
        if (action === "learn-target" || action.endsWith("target")) {
          if ((existing?.version ?? 0) !== data.expectedStateVersion) return { ok: false, status: 409, payload: { ...payload(), error: "用法状态已更新" } };
          const state: VocabularyTargetState = { targetId: target.id, wordId: word.id, normalizedTerm: target.normalizedTerm,
            version: (existing?.version ?? 0) + 1, paused: action === "know-target", introducedAt: action === "learn-target" ? new Date(now).toISOString() : existing?.introducedAt ?? null,
            step: action === "learn-target" ? 1 : existing?.step ?? 0, dueAt: action === "learn-target" ? new Date(now + 60_000).toISOString() : null, lastSubmissionId: null };
          targetStates = [state];
        } else {
          const existingTerm = termDispositions.find((state) => state.normalizedTerm === target.normalizedTerm);
          if ((existingTerm?.version ?? 0) !== data.expectedStateVersion) return { ok: false, status: 409, payload: { ...payload(), error: "整词状态已更新" } };
          termDispositions = [{ normalizedTerm: target.normalizedTerm, paused: action === "pause-term", version: (existingTerm?.version ?? 0) + 1 }];
        }
        operations.set(operationId, { operationId, action });
        session = { ...session, revision: session.revision + 1, state: { ...session.state, current: null } };
      }
      if (operationFailure === "after") { operationFailure = null; throw new TypeError("response lost"); }
      return { ok: true, status: 200, payload: { ...payload(), word } };
    } else if (data && url.endsWith("/review")) {
      const current = session.state.current!;
      if (data.targetId !== target.id || data.targetVersion !== target.version || data.purpose !== current.purpose)
        return { ok: false, status: 409, payload: { ...payload(), error: "旧题面已失效" } };
      const auxiliary = current.purpose === "consolidation" || current.purpose === "supplemental";
      if (!auxiliary) word = { ...word, reviewVersion: word.reviewVersion + 1, repetitions: word.repetitions + 1 };
      session = { ...session, revision: session.revision + 1, state: { ...session.state, current: null,
        reviewed: session.state.reviewed + Number(!auxiliary), supplementalReviewed: (session.state.supplementalReviewed ?? 0) + Number(auxiliary), lastSubmissionId: String(data.submissionId) } };
      return { ok: true, status: 200, payload: { ...payload(), word, review: { supplemental: auxiliary } as never } };
    }
    const operationId = new URL(url, "http://localhost").searchParams.get("operationId");
    return { ok: true, status: 200, payload: { ...payload(), ...(operationId ? { operation: operations.get(operationId) ?? null } : {}) } };
  };
  const clients: VocabularySessionClient[] = [];
  const client = () => { const value = new VocabularySessionClient([word], now, transport); clients.push(value); return value; };
  return { client, clients, cache, calls, operations, word: () => word, server: () => session, states: () => targetStates,
    fail: (when: "before" | "after", failures = 0) => { operationFailure = when; readFailures = failures; }, failReads: () => { readFailures++; },
    useReview: (purpose: "consolidation" | "merged") => { session.state.current = { ...card, phase: "front", purpose, supplemental: purpose === "consolidation" }; },
    changeTargetVersion: () => { session.state.current = null; session.revision++; } };
}
const fixtures: ReturnType<typeof fixture>[] = [];
function setup() { const value = fixture(); fixtures.push(value); return value; }
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { for (const f of fixtures.splice(0)) for (const client of f.clients) client.dispose(); vi.useRealTimers(); });

describe("durable advanced vocabulary client", () => {
  it("confirms an old word's new sense with frozen target versions without changing its FSRS or grading", async () => {
    const f = setup(); const client = f.client(); await client.initialize(f.cache); const before = structuredClone(f.word());
    await client.learnWord(f.word());
    const sent = f.calls.find((call) => call.url.endsWith("/learn"))!.body!;
    expect(sent).toMatchObject({ expectedVersion: 12, targetId: target.id, targetVersion: 2, expectedStateVersion: 0, restoreVersion: 4, sessionId: f.server().id });
    expect(sent.wordId).toBeUndefined(); expect(sent.operationId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(f.word()).toEqual(before); expect(f.server().state).toMatchObject({ reviewed: 0, learned: 0, supplementalReviewed: 0 });
    expect(f.states()[0]).toMatchObject({ introducedAt: new Date(now).toISOString(), step: 1, dueAt: new Date(now + 60_000).toISOString() });
    expect(client.getSnapshot().message).toContain("原复习计划保持不变");
  });
  it("queries a lost introduction acknowledgement and never duplicates confirmation", async () => {
    const f = setup(); const client = f.client(); await client.initialize(f.cache); f.fail("after");
    await client.learnWord(f.word());
    expect(client.getSnapshot().pendingOperation).toBeNull(); expect(f.operations.size).toBe(1);
    expect(f.calls.filter((call) => call.url.endsWith("/learn"))).toHaveLength(1);
    expect(f.calls.some((call) => call.url.startsWith("/api/vocabulary/targets?operationId="))).toBe(true);
    expect(client.getSnapshot().message).toContain("已核对");
  });
  it("restores an unresolved intro operation and verifies the original ID before a safe retry", async () => {
    const f = setup(); const first = f.client(); await first.initialize(f.cache); f.fail("before");
    await first.learnWord(f.word()); const pending = first.getSnapshot().pendingOperation!; first.dispose();
    const restored = f.client(); await restored.initialize(f.cache);
    expect(restored.getSnapshot().pendingOperation).toEqual(pending);
    f.failReads(); await restored.retryOperation();
    expect(f.calls.filter((call) => call.url.endsWith("/learn"))).toHaveLength(1);
    expect(restored.getSnapshot().pendingOperation).toEqual(pending);
    await restored.retryOperation();
    expect(f.calls.filter((call) => call.url.endsWith("/learn")).map((call) => call.body!.operationId)).toEqual([pending.input.operationId, pending.input.operationId]);
    expect(f.operations.size).toBe(1);
  });
  it("recovers a saved intro when both its response and first ledger read were lost", async () => {
    const f = setup(); const first = f.client(); await first.initialize(f.cache); f.fail("after", 1);
    await first.learnWord(f.word()); expect(first.getSnapshot().pendingOperation?.kind).toBe("learn"); first.dispose();
    const restored = f.client(); await restored.initialize(f.cache);
    expect(restored.getSnapshot().pendingOperation).toBeNull(); expect(f.operations.size).toBe(1);
    expect(f.calls.filter((call) => call.url.endsWith("/learn"))).toHaveLength(1);
  });
  it("persists self-known and whole-word pause as distinct non-scoring choices", async () => {
    const f = setup(); const client = f.client(); await client.initialize(f.cache); const before = structuredClone(f.word());
    await client.disposition({ action: "know-target", targetId: target.id, targetVersion: 2, expectedStateVersion: 0, restoreVersion: 4 });
    expect(client.getSnapshot().targetCounts).toMatchObject({ pausedTargets: 1, pausedTerms: 0, introducedTargets: 0 });
    await client.disposition({ action: "pause-term", term: target.normalizedTerm, expectedStateVersion: 0, restoreVersion: 4 });
    expect(client.getSnapshot().targetCounts).toMatchObject({ pausedTargets: 1, pausedTerms: 1 });
    await client.disposition({ action: "resume-term", term: target.normalizedTerm, expectedStateVersion: 1, restoreVersion: 4 });
    expect(client.getSnapshot().targetCounts).toMatchObject({ pausedTargets: 1, pausedTerms: 0 });
    expect(f.word()).toEqual(before); expect(f.server().state).toMatchObject({ reviewed: 0, learned: 0, supplementalReviewed: 0 });
    expect(f.calls.filter((call) => call.url.endsWith("/review"))).toHaveLength(0);
  });
  it("retains a lost disposition operation until the ledger confirms it without replaying", async () => {
    const f = setup(); const client = f.client(); await client.initialize(f.cache); f.fail("after", 1);
    await client.disposition({ action: "pause-term", term: target.normalizedTerm, expectedStateVersion: 0, restoreVersion: 4 });
    const pending = client.getSnapshot().pendingOperation!;
    expect(parseVocabularyRecovery(f.cache.getItem(vocabularyRecoveryKey))!.pendingOperation).toEqual(pending);
    await client.retryOperation();
    expect(f.calls.filter((call) => call.url === "/api/vocabulary/targets")).toHaveLength(1);
    expect(client.getSnapshot().termDispositions[0]).toMatchObject({ paused: true, version: 1 });
  });
  it("drops an unsaved intro after its card changes instead of confirming a different sense", async () => {
    const f = setup(); const client = f.client(); await client.initialize(f.cache); f.fail("before");
    await client.learnWord(f.word()); f.changeTargetVersion(); await client.retryOperation();
    expect(client.getSnapshot().pendingOperation).toBeNull(); expect(f.operations.size).toBe(0);
    expect(f.calls.filter((call) => call.url.endsWith("/learn"))).toHaveLength(1);
  });
  it.each(["consolidation", "merged"] as const)("freezes %s review purpose and counts only its intended ledger", async (purpose) => {
    const f = setup(); f.useReview(purpose); const client = f.client(); await client.initialize(f.cache); const before = structuredClone(f.word());
    client.changeDraft({ answer: "state", phase: "revealed" });
    await client.reviewWord(f.word(), { rating: "good", ratingSource: "automatic", mode: "context", userAnswer: "state", confirmedTypo: false, gaveUp: false, durationSeconds: 4 });
    expect(f.calls.find((call) => call.url.endsWith("/review"))!.body).toMatchObject({ purpose, targetId: target.id, targetVersion: 2,
      expectedStateVersion: 0, restoreVersion: 4, policyVersion: 9, exerciseId: "state-context-1", exerciseVersion: 5, membershipVersion: 3 });
    expect(f.server().state).toMatchObject({ reviewed: purpose === "merged" ? 1 : 0, supplementalReviewed: purpose === "consolidation" ? 1 : 0 });
    if (purpose === "consolidation") expect(f.word()).toEqual(before);
  });
});
