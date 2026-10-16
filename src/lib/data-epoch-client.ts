"use client";
import { useCallback, useEffect, useRef, useState } from "react";
/** A restored or conflicting page is retained as an export-only recovery copy. */
export function useDataEpochGuard(onFreeze: () => void) {
  const [frozen, setFrozen] = useState(false);
  const frozenRef = useRef(false);
  const cancellation = useRef<AbortController | null>(null);
  const requestSignal = useCallback(() => {
    cancellation.current ??= new AbortController();
    return cancellation.current.signal;
  }, []);
  const action = useRef(onFreeze);
  useEffect(() => { action.current = onFreeze; }, [onFreeze]);
  const freeze = useCallback(() => {
    if (frozenRef.current) return;
    frozenRef.current = true;
    cancellation.current?.abort();
    window.speechSynthesis?.cancel();
    document.querySelectorAll("audio,video").forEach((element) => (element as HTMLMediaElement).pause());
    action.current(); setFrozen(true);
  }, []);
  useEffect(() => {
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("ielts-studio-restores");
    if (channel) channel.onmessage = (event) => { if (event.data?.type === "studio:backup-restored") freeze(); };
    window.addEventListener("studio:backup-restored", freeze);
    return () => { channel?.close(); window.removeEventListener("studio:backup-restored", freeze); };
  }, [freeze]);
  return { frozen, frozenRef, freeze, requestSignal };
}
export function exportRecoveryCopy(name: string, value: unknown) {
  const href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a"); anchor.href = href; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
