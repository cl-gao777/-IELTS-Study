import { describe, expect, it, vi } from "vitest";
import { MockExamClient, type MockClientTransport } from "./mock-exam-client";
import { initialMockState, type MockSession } from "./mock-exam";
const baseSet = { id: "sample", kind: "reading" as const, title: "Sample", subtitle: "", instructions: "", passage: "Text", transcript: "", audioUrl: "", durationMinutes: 20, questions: [] };
function session(): MockSession { return { id: "session", dataEpoch: "epoch", revision: 1, submissionId: "submission", startedAt: "2026-10-13", status: "active", state: { ...initialMockState(), stage: "writing", essay: "Saved essay contains at least forty characters for final submission." }, listeningSet: { ...baseSet, kind: "listening" }, readingSet: baseSet, writingPrompt: "Discuss transport", result: null, writerId: "writer-a", leaseUntil: new Date(Date.now() + 60000).toISOString() }; }
function response(payload: Record<string, unknown>) { return { ok: true, status: 200, payload: structuredClone(payload) }; }
describe("independent mock race regressions", () => {
  it("a readonly tab must not overwrite another tab's unsaved browser checkpoint", async () => {
    const current = session();
    let cache: unknown = { id: current.id, dataEpoch: current.dataEpoch, revision: current.revision, writerId: "writer-a", state: { ...current.state, essay: "Unsaved text from the active page" }, pendingSubmission: true };
    const transport: MockClientTransport = { writerId: "writer-b", read: () => cache, write: (value) => { cache = value; }, request: async () => response({ session: current, dataEpoch: current.dataEpoch }) };
    const client = new MockExamClient(transport); await client.initialize();
    expect((cache as { state: { essay: string }; pendingSubmission: boolean }).state.essay).toBe("Unsaved text from the active page");
    expect((cache as { pendingSubmission: boolean }).pendingSubmission).toBe(true);
  });
  it("an unmatched cache version retains unsaved text as a recovery copy", async () => {
    const current = session(); current.revision = 2;
    let cache: unknown = { id: current.id, dataEpoch: current.dataEpoch, revision: 1, writerId: "writer-a", state: { ...current.state, essay: "Typing after an unacknowledged checkpoint" }, pendingSubmission: true };
    const client = new MockExamClient({ writerId: "writer-a", read: () => cache, write: (value) => { cache = value; }, request: async () => response({ session: current, dataEpoch: current.dataEpoch }) });
    await client.initialize();
    expect(JSON.stringify({ cache, view: client.getSnapshot() })).toContain("Typing after an unacknowledged checkpoint");
  });
  it("resuming while pause acknowledgement is pending cannot strand an unpaused readonly page", async () => {
    let current = session(); let release!: () => void;
    const client = new MockExamClient({ writerId: "writer-a", read: () => null, write: () => {}, request: async (_url, body) => {
      if (!body) return response({ session: current, dataEpoch: current.dataEpoch });
      const input = body as { action: string; release?: boolean; state?: MockSession["state"] };
      if (input.action === "claim") { current = { ...current, writerId: "writer-a", leaseUntil: new Date(Date.now() + 60000).toISOString() }; return response({ session: current }); }
      if (input.action === "checkpoint") {
        if (input.release) await new Promise<void>((resolve) => { release = resolve; });
        current = { ...current, revision: current.revision + 1, state: structuredClone(input.state!), writerId: input.release ? null : "writer-a" };
        return response({ session: current });
      }
      throw new Error("Unexpected action");
    } });
    await client.initialize(); await client.resume();
    const pausing = client.pause(); await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const resuming = client.resume(); release(); await Promise.all([pausing, resuming]);
    const view = client.getSnapshot();
    expect(view.state?.paused || view.writer).toBe(true);
  });
  it("reconciles the original journal before retrying after both acknowledgement and lookup were lost", async () => {
    let current = session(), loseWrite = false, loseRead = false;
    const client = new MockExamClient({ writerId: "writer-a", read: () => null, write: () => {}, request: async (_url, body) => {
      if (!body) { if (loseRead) { loseRead = false; throw new Error("read unavailable"); } return response({ session: current, dataEpoch: current.dataEpoch }); }
      const input = body as { action: string; expectedRevision?: number; state?: MockSession["state"] };
      if (input.action === "claim") return response({ session: current });
      if (input.action === "checkpoint") {
        if (input.expectedRevision !== current.revision) return { ok: false, status: 409, payload: { code: "DRAFT_CONFLICT", error: "stale" } };
        current = { ...current, revision: current.revision + 1, state: structuredClone(input.state!) };
        if (loseWrite) { loseWrite = false; loseRead = true; throw new Error("acknowledgement unavailable"); }
        return response({ session: current });
      }
      throw new Error("Unexpected action");
    } });
    await client.initialize(); await client.resume();
    client.change({ essay: "Text saved by the server but acknowledgement is missing" }); loseWrite = true;
    await client.checkpoint();
    client.change({ essay: "Additional input after the server saved the prior snapshot" });
    await client.checkpoint();
    expect(client.getSnapshot().frozen).toBe(false);
    expect(current.state.essay).toBe("Additional input after the server saved the prior snapshot");
  });
  it("a background pause arriving during resume cannot be undone by a late claim acknowledgement", async () => {
    let current = session(), finishClaim!: () => void;
    const client = new MockExamClient({ writerId: "writer-a", read: () => null, write: () => {}, request: async (_url, body) => {
      if (!body) return response({ session: current, dataEpoch: current.dataEpoch });
      const input = body as { action: string; release?: boolean; state?: MockSession["state"] };
      if (input.action === "claim") { await new Promise<void>((resolve) => { finishClaim = resolve; }); return response({ session: current }); }
      if (input.action === "checkpoint") { current = { ...current, state: structuredClone(input.state!), revision: current.revision + 1, writerId: input.release ? null : "writer-a" }; return response({ session: current }); }
      throw new Error("Unexpected action");
    } });
    await client.initialize();
    const resume = client.resume(); await vi.waitFor(() => expect(finishClaim).toBeTypeOf("function"));
    await client.pause(true); finishClaim(); await resume;
    expect(client.getSnapshot().state?.paused).toBe(true);
    client.tick(5); expect(client.getSnapshot().state?.durations.writing).toBe(0);
  });
});
