import type { MorphologyStudyInput, MorphologyWorkspace } from "./morphology";
import { morphologyTimePrefix } from "./morphology-client";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
type Binding = { dataEpoch: string; sessionId: string };
type Sender = (packet: MorphologyStudyInput) => Promise<MorphologyWorkspace>;
const dateOf = (now: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/** Recovered packets keep their old ID; a new tab never accrues time onto another tab's packet. */
export class MorphologyStudyClock {
  private packets = new Map<string, MorphologyStudyInput>();
  private current: { packet: MorphologyStudyInput; milliseconds: number } | null = null;
  private last: number | null = null;
  private wasActive = false;
  private chain: Promise<void> = Promise.resolve();
  private stopped = false;
  constructor(private binding: () => Binding | null, private send: Sender, private storage?: StorageLike) {
    try {
      for (let index = 0; index < (storage?.length ?? 0); index++) {
        const key = storage?.key(index); if (!key?.startsWith(morphologyTimePrefix)) continue;
        const packet = JSON.parse(storage!.getItem(key) || "null") as MorphologyStudyInput | null;
        if (packet && /^[0-9a-f-]{36}$/i.test(packet.segmentId) && Number.isInteger(packet.seconds) && packet.seconds > 0 && packet.seconds <= 86400
          && typeof packet.dataEpoch === "string" && typeof packet.sessionId === "string" && /^\d{4}-\d{2}-\d{2}$/.test(packet.studyDate)) this.packets.set(packet.segmentId, packet);
      }
    } catch {}
  }
  sample(now: number, active: boolean) {
    if (this.stopped) return;
    const binding = this.binding(); const date = dateOf(now);
    if (this.current && (!binding || this.current.packet.dataEpoch !== binding.dataEpoch || this.current.packet.sessionId !== binding.sessionId || this.current.packet.studyDate !== date)) { this.current = null; this.last = now; this.wasActive = false; }
    if (binding && active && !this.current) this.current = { packet: { ...binding, segmentId: crypto.randomUUID(), studyDate: date, seconds: 0 }, milliseconds: 0 };
    if (this.current && this.last !== null && this.wasActive) this.current.milliseconds += Math.min(Math.max(0, now - this.last), 2000);
    this.last = now; this.wasActive = active && Boolean(binding);
    if (this.current) {
      const seconds = Math.floor(this.current.milliseconds / 1000);
      if (seconds > this.current.packet.seconds) {
        this.current.packet = { ...this.current.packet, seconds }; this.packets.set(this.current.packet.segmentId, this.current.packet);
        try { this.storage?.setItem(morphologyTimePrefix + this.current.packet.segmentId, JSON.stringify(this.current.packet)); } catch {}
      }
    }
  }
  flush() {
    const run = async () => {
      if (this.stopped) return;
      for (const packet of [...this.packets.values()]) {
        if (this.stopped) return;
        const epoch = this.binding()?.dataEpoch;
        if (epoch && packet.dataEpoch !== epoch) { this.packets.delete(packet.segmentId); this.storage?.removeItem(morphologyTimePrefix + packet.segmentId); continue; }
        try {
          await this.send(packet);
          if ((this.packets.get(packet.segmentId)?.seconds ?? 0) <= packet.seconds) {
            this.packets.delete(packet.segmentId);
            try { const cached = JSON.parse(this.storage?.getItem(morphologyTimePrefix + packet.segmentId) || "null"); if (!cached || cached.seconds <= packet.seconds) this.storage?.removeItem(morphologyTimePrefix + packet.segmentId); } catch {}
          }
        } catch { return; }
      }
    };
    this.chain = this.chain.catch(() => undefined).then(run); return this.chain;
  }
  get unsavedSeconds() { return [...this.packets.values()].reduce((sum, packet) => sum + packet.seconds, 0); }
  stop() { this.stopped = true; this.wasActive = false; this.last = null; }
}
