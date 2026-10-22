export const BACKUP_RESTORED_EVENT = "studio:backup-restored";
export const BACKUP_RESTORE_CHANNEL = "ielts-studio-restores";

/** Browser caches never take precedence over a successfully restored database. */
export function notifyBackupRestored() {
  for (const key of ["ielts-studio-writing-recovery", "ielts-studio-vocabulary-recovery", "ielts-studio-vocabulary-assessment", "ielts-studio-vocabulary-study", "ielts-studio-morphology-recovery"]) {
    try { localStorage.removeItem(key); } catch { /* Storage may be unavailable; still invalidate open screens. */ }
  }
  try {
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index);
      if (key?.startsWith("ielts-studio-morphology-time:segment:")) localStorage.removeItem(key);
    }
  } catch { /* Epoch validation also rejects stale unsent time packets. */ }
  window.dispatchEvent(new Event(BACKUP_RESTORED_EVENT));
  if (typeof BroadcastChannel !== "undefined") {
    try {
      const channel = new BroadcastChannel(BACKUP_RESTORE_CHANNEL);
      channel.postMessage({ type: BACKUP_RESTORED_EVENT });
      channel.close();
    } catch { /* Same-tab invalidation and server revision checks remain effective. */ }
  }
}
