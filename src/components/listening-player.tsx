"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import ui from "./page-ui.module.css";
import styles from "./practice.module.css";

export function ListeningPlayer({ audioUrl, transcript, onRange }: { audioUrl: string; transcript: string; onRange: (range: { startSeconds?: number; endSeconds?: number }) => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [a, setA] = useState(0); const [b, setB] = useState(0);
  const [loop, setLoop] = useState(false); const [speed, setSpeed] = useState(1);
  const [position, setPosition] = useState(0); const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState("");
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const seek = useCallback((amount: number) => { const el = audio.current; if (el && Number.isFinite(el.duration)) el.currentTime = Math.max(0, Math.min(el.duration, el.currentTime + amount)); }, []);
  const toggle = useCallback(async () => {
    const el = audio.current; if (!el) return;
    try { if (el.paused) await el.play(); else el.pause(); } catch { setStatus("无法播放此文件。请检查文件是否存在，或使用 MP3 / WAV 格式。"); }
  }, []);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (/INPUT|TEXTAREA|SELECT|BUTTON/.test(target.tagName) || target.isContentEditable || event.ctrlKey || event.metaKey || event.altKey || !audioUrl) return;
      if (event.code === "Space") { event.preventDefault(); void toggle(); }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); seek(event.key === "ArrowLeft" ? -5 : 5); }
    };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, [audioUrl, seek, toggle]);
  useEffect(() => { if (audio.current) audio.current.playbackRate = speed; }, [speed]);
  useEffect(() => {
    if (!loop || b <= a) return;
    const timer = window.setInterval(() => { const el = audio.current; if (el && !el.paused && el.currentTime >= b) el.currentTime = a; }, 60);
    return () => window.clearInterval(timer);
  }, [loop, a, b]);
  useEffect(() => () => window.speechSynthesis?.cancel(), []);
  function speak() {
    if (!("speechSynthesis" in window)) { setStatus("此浏览器不支持 TTS。可导入本地音频。"); return; }
    if (ttsPlaying) { window.speechSynthesis.cancel(); setTtsPlaying(false); return; }
    window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(transcript); utterance.lang = "en-GB"; utterance.rate = speed;
    const britishVoice = window.speechSynthesis.getVoices().find((voice) => voice.lang === "en-GB"); if (britishVoice) utterance.voice = britishVoice;
    utterance.onend = () => setTtsPlaying(false); utterance.onerror = () => { setTtsPlaying(false); setStatus("系统语音不可用，请导入音频。"); };
    setTtsPlaying(true); window.speechSynthesis.speak(utterance);
  }
  function changeRange(start: number, end: number) { setA(start); setB(end); if (end <= start) setLoop(false); onRange({ startSeconds: start, endSeconds: end > start ? end : undefined }); }
  return <section className={styles.audioPanel} aria-label="精听播放器"><h2>Listening · 精听播放器</h2>
    {audioUrl ? <><audio ref={audio} controls preload="metadata" src={audioUrl} onTimeUpdate={() => setPosition(audio.current?.currentTime || 0)} onLoadedMetadata={() => setDuration(audio.current?.duration || 0)} onError={() => setStatus("音频加载失败。请检查原文件或导入浏览器支持的 MP3 / WAV。")} onEnded={() => { if (loop && audio.current && b > a) { audio.current.currentTime = a; void audio.current.play().catch(() => setStatus("请点击播放继续。")); } }} />
      <div className={styles.toolbar}><button className={ui.button} type="button" onClick={toggle}>播放 / 暂停</button>{[-10, -5, 5, 10].map((amount) => <button className={ui.buttonGhost} key={amount} type="button" onClick={() => seek(amount)}>{amount > 0 ? "+" : ""}{amount}s</button>)}</div>
      <p>{position.toFixed(1)} / {Number.isFinite(duration) ? duration.toFixed(1) : "—"} 秒 · Space 播放暂停 · ← / → 跳转 5 秒</p>
      <div className={styles.abControls}><label>A（秒）<input className={ui.input} type="number" min="0" step="0.1" value={a} onChange={(event) => changeRange(Math.max(0, Number(event.target.value)), b)} /></label><button className={ui.buttonGhost} type="button" onClick={() => changeRange(Number(position.toFixed(1)), b)}>设 A = 当前</button><label>B（秒）<input className={ui.input} type="number" min="0" step="0.1" value={b} onChange={(event) => changeRange(a, Math.max(0, Number(event.target.value)))} /></label><button className={ui.buttonGhost} type="button" onClick={() => changeRange(a, Number(position.toFixed(1)))}>设 B = 当前</button></div>
      <button className={loop ? ui.button : ui.buttonGhost} type="button" disabled={b <= a || b > duration || a >= duration} onClick={() => { setLoop(!loop); if (!loop && audio.current) { audio.current.currentTime = a; void audio.current.play().catch(() => setStatus("请点击播放继续。")); } }}>{loop ? "关闭 AB 循环" : "开始 AB Repeat"}</button><p>选择 B &gt; A 的片段，配合听写或 Shadowing 跟读。</p>
    </> : <><p>此原创示例使用系统 TTS。导入本地 MP3 / WAV / M4A 后可使用 Seek 与 AB 循环。</p><button className={ui.button} type="button" disabled={!transcript} onClick={speak}>{ttsPlaying ? "停止 TTS" : "播放英式 TTS"}</button></>}
    <label className={styles.speedLabel}>播放速度<select className={ui.select} value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>{[0.75, 0.9, 1, 1.1, 1.25].map((rate) => <option key={rate} value={rate}>{rate.toFixed(2)}×</option>)}</select></label>
    {status && <p className={ui.notice} role="alert">{status}</p>}
  </section>;
}
