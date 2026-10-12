import { afterEach, describe, expect, it, vi } from "vitest";
import { BACKUP_RESTORED_EVENT, BACKUP_RESTORE_CHANNEL, notifyBackupRestored } from "./backup-recovery";

afterEach(() => vi.unstubAllGlobals());

describe("backup restore browser invalidation", () => {
  it("clears writing, vocabulary, assessment and timer caches and tells every tab to reload", () => {
    const removeItem = vi.fn(), dispatchEvent = vi.fn(), postMessage = vi.fn(), close = vi.fn();
    vi.stubGlobal("localStorage", { removeItem });
    vi.stubGlobal("window", { dispatchEvent });
    const channels: string[] = [];
    vi.stubGlobal("BroadcastChannel", class { constructor(name: string) { channels.push(name); } postMessage = postMessage; close = close; });
    notifyBackupRestored();
    expect(removeItem.mock.calls).toEqual([["ielts-studio-writing-recovery"], ["ielts-studio-vocabulary-recovery"], ["ielts-studio-vocabulary-assessment"], ["ielts-studio-vocabulary-study"]]);
    expect(dispatchEvent.mock.calls[0][0].type).toBe(BACKUP_RESTORED_EVENT);
    expect(channels).toEqual([BACKUP_RESTORE_CHANNEL]);
    expect(postMessage).toHaveBeenCalledWith({ type: BACKUP_RESTORED_EVENT });
    expect(close).toHaveBeenCalledOnce();
  });
  it("does not suppress restored-session invalidation when browser storage is unavailable", () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("localStorage", { removeItem() { throw new Error("denied"); } });
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal("BroadcastChannel", undefined);
    expect(() => notifyBackupRestored()).not.toThrow();
    expect(dispatchEvent).toHaveBeenCalledOnce();
  });
});
