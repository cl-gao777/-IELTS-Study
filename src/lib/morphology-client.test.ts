import { describe, expect, it } from "vitest";
import { MorphologyClient, morphologyRecoveryKey, type MorphologyTransport } from "./morphology-client";
import type { MorphologyWorkspace } from "./morphology";

function fixture() {
  let workspace = { dataEpoch: "epoch-one", todaySeconds: 0, totalSeconds: 0,
    session: { id: "00000000-0000-4000-8000-000000000001", revision: 1, status: "active", startedAt: "2026-10-22T00:00:00Z", updatedAt: "2026-10-22T00:00:00Z",
      state: { lesson: { id: "root-port", version: 1 }, phase: "practice", questionIndex: 0, input: "", hintUsed: false,
        questions: [{ id: "q1", kind: "context", prompt: "A ______ report.", options: [], acceptedAnswers: ["portable"], hint: "可携带", explanation: "构词解析", sentence: "A portable report.", wordId: "portable" }], results: [], retry: "initial", paused: false } } } as unknown as MorphologyWorkspace;
  const values = new Map<string, string>(); const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const attempts: string[] = []; let loseAttempt = false; let conflict = false;
  let holdSave: (() => Promise<void>) | null = null;
  const bound = () => { const copy = structuredClone(workspace); const result = copy.session!.state.results.at(-1); return { ...copy, currentSessionId: copy.session!.id,
    ...(result ? { submission: { sessionId: copy.session!.id, lessonVersion: copy.session!.state.lesson.version, result } } : {}) }; };
  const send: MorphologyTransport = async (path, method, raw) => {
    const body = raw as Record<string, unknown>;
    if (conflict && method) return { status: 409, payload: { error: "数据已恢复" } };
    if (path.startsWith("/api/morphology/attempts?")) return { status: 200, payload: { found: attempts.includes(new URL("http://local" + path).searchParams.get("operationId")!), workspace: bound() } };
    if (method === "PUT" && body.action === "save") {
      if (holdSave) { const hold = holdSave; holdSave = null; await hold(); }
      workspace.session!.revision++; workspace.session!.state.input = String(body.input);
    }
    if (method === "POST") {
      attempts.push(String(body.operationId)); workspace.session!.revision++;
      workspace.session!.state.results.push({ questionId: "q1", answer: String(body.answer), correct: body.answer === "portable", hintUsed: false, gaveUp: Boolean(body.gaveUp), firstAttempt: true,
        acceptedAnswers: ["portable"], explanation: "构词解析", sentence: "A portable report.", submittedAt: "2026-10-22T00:00:00Z", operationId: String(body.operationId) });
      if (loseAttempt) { loseAttempt = false; throw new TypeError("response lost"); }
    }
    return { status: 200, payload: method === "POST" ? bound() : structuredClone(workspace) };
  };
  return { client: new MorphologyClient(send), send, storage, values, attempts,
    get workspace() { return workspace; }, set workspace(next: MorphologyWorkspace) { workspace = next; },
    loseAttempt: () => { loseAttempt = true; }, conflict: () => { conflict = true; }, holdSave: (hold: () => Promise<void>) => { holdSave = hold; } };
}

describe("morphology client durability", () => {
  it("restores an unsubmitted input only for the exact server revision and question", async () => {
    const f = fixture(); f.values.set(morphologyRecoveryKey, JSON.stringify({ dataEpoch: "epoch-one", sessionId: f.workspace.session!.id, revision: 1, questionId: "q1", input: "portable", pending: null }));
    await f.client.initialize(f.storage); expect(f.client.getSnapshot().workspace?.session?.state.input).toBe("portable");
    await f.client.flush(); expect(f.workspace.session?.state.input).toBe("portable"); f.client.dispose();
  });
  it("does not replace a newer typed input with a checkpoint acknowledgement", async () => {
    const f = fixture(); await f.client.initialize(f.storage); f.client.setInput("port"); let release!: () => void;
    f.holdSave(() => new Promise<void>(resolve => { release = resolve; })); const pending = f.client.flush();
    await Promise.resolve(); f.client.setInput("portable"); release(); await pending;
    expect(f.client.getSnapshot().workspace?.session?.state.input).toBe("portable"); expect(f.workspace.session?.state.input).toBe("portable"); f.client.dispose();
  });
  it("ignores an in-flight success after a restore freezes the page", async () => {
    const f = fixture(); await f.client.initialize(f.storage); f.client.setInput("portable"); let release!: () => void;
    f.holdSave(() => new Promise<void>(resolve => { release = resolve; })); const pending = f.client.flush();
    await Promise.resolve(); f.client.freezeAfterRestore(); release(); await pending;
    expect(f.client.getSnapshot().frozen).toBe(true); expect(f.client.getSnapshot().workspace?.session?.revision).toBe(1);
    expect(f.client.getSnapshot().retainedInput).toBe("portable"); expect(f.client.getSnapshot().saving).toBe(false); f.client.dispose();
  });
  it("restores typing made during an acknowledged checkpoint after navigating away", async () => {
    const f = fixture(); await f.client.initialize(f.storage); f.client.setInput("port"); let release!: () => void;
    f.holdSave(() => new Promise<void>(resolve => { release = resolve; })); const pending = f.client.flush();
    await Promise.resolve(); f.client.setInput("portable"); f.client.dispose(); release(); await pending;
    expect(f.workspace.session?.state.input).toBe("port");
    const next = new MorphologyClient(f.send); await next.initialize(f.storage);
    expect(next.getSnapshot().workspace?.session?.state.input).toBe("portable"); expect(next.getSnapshot().retainedInput).toBe("");
    await next.flush(); expect(f.workspace.session?.state.input).toBe("portable"); next.dispose();
  });
  it("queries a lost grading response and never makes a second scoring request", async () => {
    const f = fixture(); await f.client.initialize(f.storage); f.client.setInput("portable"); f.loseAttempt(); await f.client.submit();
    expect(f.attempts).toHaveLength(1); expect(f.client.getSnapshot().pending).toBeNull(); expect(f.client.getSnapshot().workspace?.session?.state.results).toHaveLength(1); f.client.dispose();
  });
  it("serializes rapid double submit while the input checkpoint is saving", async () => {
    const f = fixture(); await f.client.initialize(f.storage); f.client.setInput("portable");
    await Promise.all([f.client.submit(), f.client.submit()]);
    expect(f.attempts).toHaveLength(1); expect(f.client.getSnapshot().frozen).toBe(false); f.client.dispose();
  });
  it("freezes a rejected old page while keeping the original answer", async () => {
    const f = fixture(); await f.client.initialize(f.storage); f.client.setInput("unsaved answer"); f.conflict(); await f.client.flush();
    expect(f.client.getSnapshot().frozen).toBe(true); expect(f.client.getSnapshot().retainedInput).toBe("unsaved answer");
    f.client.setInput("new value"); expect(f.client.getSnapshot().retainedInput).toBe("unsaved answer"); f.client.dispose();
  });
  it("keeps recovery from an older epoch separate instead of replaying it", async () => {
    const f = fixture(); f.values.set(morphologyRecoveryKey, JSON.stringify({ dataEpoch: "old", sessionId: f.workspace.session!.id, revision: 1, questionId: "q1", input: "old answer", pending: null }));
    await f.client.initialize(f.storage); expect(f.workspace.session?.state.input).toBe(""); expect(f.client.getSnapshot().retainedInput).toBe("old answer"); f.client.dispose();
  });
  it("confirms a saved original answer but freezes when another page has started a new round", async () => {
    const f = fixture(); const client = new MorphologyClient(async (path, method, body) => {
      const response = await f.send(path, method, body);
      if (path.startsWith("/api/morphology/attempts?")) (response.payload as { workspace: MorphologyWorkspace & { currentSessionId: string } }).workspace.currentSessionId = "another-round";
      return response;
    });
    await client.initialize(f.storage); client.setInput("portable"); f.loseAttempt(); await client.submit();
    expect(f.attempts).toHaveLength(1); expect(client.getSnapshot().pending).toBeNull(); expect(client.getSnapshot().frozen).toBe(true);
    expect(client.getSnapshot().retainedInput).toBe("portable"); client.dispose();
  });
  it("never adopts a result whose original answer does not match this submission", async () => {
    const f = fixture(); const client = new MorphologyClient(async (path, method, body) => {
      const response = await f.send(path, method, body);
      if (method === "POST") (response.payload as MorphologyWorkspace & { submission: { result: { answer: string } } }).submission.result.answer = "different answer";
      return response;
    });
    await client.initialize(f.storage); client.setInput("portable"); await client.submit();
    expect(client.getSnapshot().frozen).toBe(true); expect(client.getSnapshot().retainedInput).toBe("portable"); expect(f.attempts).toHaveLength(1); client.dispose();
  });
  it("looks up a pending original submission after a different round was opened", async () => {
    const f = fixture(); let lookupOffline = true;
    const client = new MorphologyClient(async (path, method, body) => {
      if (path.startsWith("/api/morphology/attempts?") && lookupOffline) throw new TypeError("offline");
      return f.send(path, method, body);
    });
    await client.initialize(f.storage); client.setInput("portable"); f.loseAttempt(); await client.submit();
    expect(client.getSnapshot().pending).not.toBeNull(); const original = structuredClone(f.workspace); client.dispose();
    f.workspace.session!.id = "00000000-0000-4000-8000-000000000002"; f.workspace.session!.revision = 1; lookupOffline = false;
    const next = new MorphologyClient(async (path, method, body) => {
      if (path.startsWith("/api/morphology/attempts?")) return { status: 200, payload: { found: true, workspace: { ...original,
        currentSessionId: f.workspace.session!.id, submission: { sessionId: original.session!.id, lessonVersion: 1, result: original.session!.state.results[0] } } } };
      return f.send(path, method, body);
    });
    await next.initialize(f.storage);
    expect(next.getSnapshot().pending).toBeNull(); expect(next.getSnapshot().frozen).toBe(true); expect(next.getSnapshot().retainedInput).toBe("portable");
    expect(f.attempts).toHaveLength(1); next.dispose();
  });
});
