import { useCallback, useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { tg } from "./api";

const track = new URL("./audio/nocturne.mp3", import.meta.url).href;
const volumeKey = "mafia-music-volume";

function savedVolume() {
  try {
    const raw = localStorage.getItem(volumeKey);
    const value = Number(raw);
    if (raw !== null && Number.isFinite(value) && value >= 0 && value <= 1)
      return value;
  } catch { /* Storage can be unavailable in a webview. */ }
  return 0.45;
}

export function Music() {
  const player = useRef<HTMLAudioElement>(null);
  const graph = useRef<{ context: AudioContext; gain: GainNode } | null>(null);
  const wanted = useRef(false);
  const generation = useRef(0);
  const [enabled, setEnabled] = useState(false);
  const [volume, setVolume] = useState(savedVolume);
  const [error, setError] = useState("");

  const sync = useCallback(() => {
    const audio = player.current;
    if (!audio || !graph.current) return;
    const { context } = graph.current;
    const version = ++generation.current;
    if (!wanted.current || document.hidden || tg?.isActive === false) {
      audio.pause();
      void context.suspend().catch(() => {});
      return;
    }
    if (audio.error) audio.load();
    // Both calls must start in the tap handler for mobile autoplay policies.
    void Promise.all([context.resume(), audio.play()]).catch(() => {
      if (version !== generation.current) return;
      audio.pause();
      void context.suspend().catch(() => {});
      wanted.current = false;
      setEnabled(false);
      setError("Не вдалося відтворити музику. Спробуйте ще раз.");
    });
  }, []);

  useEffect(() => {
    const audio = player.current;
    const hide = () => {
      generation.current++;
      audio?.pause();
      void graph.current?.context.suspend().catch(() => {});
    };
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", sync);
    tg?.onEvent?.("deactivated", hide);
    tg?.onEvent?.("activated", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", sync);
      tg?.offEvent?.("deactivated", hide);
      tg?.offEvent?.("activated", sync);
      generation.current++;
      audio?.pause();
      void graph.current?.context.close().catch(() => {});
      graph.current = null;
    };
  }, [sync]);

  function toggle() {
    const audio = player.current;
    if (!audio) return;
    if (!graph.current) {
      try {
        const context = new AudioContext();
        const gain = context.createGain();
        gain.gain.value = volume;
        context.createMediaElementSource(audio).connect(gain).connect(context.destination);
        graph.current = { context, gain };
      } catch {
        setError("У цьому браузері не вдалося ввімкнути музику.");
        return;
      }
    }
    wanted.current = !wanted.current;
    setEnabled(wanted.current);
    setError("");
    sync();
  }

  function changeVolume(value: number) {
    setVolume(value);
    if (graph.current) {
      const { gain, context } = graph.current;
      gain.gain.setTargetAtTime(value, context.currentTime, 0.025);
    }
    try { localStorage.setItem(volumeKey, String(value)); } catch {}
  }

  return <div className="music">
    <audio ref={player} src={track} preload="none" loop />
    <button type="button" className="music-toggle" aria-pressed={enabled}
      aria-label={enabled ? "Вимкнути музику" : "Увімкнути музику"} onClick={toggle}>
      {enabled ? <Volume2 /> : <VolumeX />} Музика
    </button>
    {enabled && <input type="range" aria-label="Гучність музики" min="0" max="100"
      value={Math.round(volume * 100)} onChange={e => changeVolume(Number(e.target.value) / 100)} />}
    {error && <small role="status" className="music-error">{error}</small>}
  </div>;
}
