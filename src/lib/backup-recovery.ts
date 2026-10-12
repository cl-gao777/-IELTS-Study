export const BACKUP_RESTORED_EVENT = "studio:backup-restored";
export const BACKUP_RESTORE_CHANNEL = "ielts-studio-restores";

/** Browser caches never take precedence over a successfully restored database. */
export function notifyBackupRestored() {
  for (const key of ["ielts-studio-writing-recovery", "ielts-studio-vocabulary-recovery", "ielts-studio-vocabulary-assessment", "ielts-studio-vocabulary-study"]) {
    try { localStorage.removeItem(key); } catch { /* Storage may be unavailable; still invalidate open screens. */ }
  }
  window.dispatchEvent(new Event(BACKUP_RESTORED_EVENT));
  if (typeof BroadcastChannel !== "undefined") {
    try {
      const channel = new BroadcastChannel(BACKUP_RESTORE_CHANNEL);
      channel.postMessage({ type: BACKUP_RESTORED_EVENT });
      channel.close();
    } catch { /* Same-tab invalidation and server revision checks remain effective. */ }
  }
}
