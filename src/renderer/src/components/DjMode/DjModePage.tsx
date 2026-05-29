/**
 * DJ Mode — Spotify-style AI DJ feature.
 * - TTS announcements between tracks (Web Speech API)
 * - AI commentary via Anthropic API
 * - Crossfade, loudness normalisation, mood selector
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@tanstack/react-store';
import { store } from '@renderer/store/store';
import MainContainer from '../MainContainer';
import TitleContainer from '../TitleContainer';
import storage from '../../utils/localStorage';

// ─── Types ────────────────────────────────────────────────────────────────────

type DjMood = 'auto' | 'chill' | 'energetic' | 'focus' | 'party' | 'sad';
type AnnouncementStyle = 'minimal' | 'friendly' | 'hype' | 'trivia';

interface DjState {
  enabled: boolean;
  mood: DjMood;
  crossfadeSec: number;
  loudnessNorm: boolean;
  ttsEnabled: boolean;
  ttsVoice: string;
  ttsRate: number;
  ttsPitch: number;
  ttsVolume: number;
  announcementStyle: AnnouncementStyle;
  announceOnEvery: number;
}

interface SessionStat {
  tracksPlayed: number;
  startTime: number;
  announcementsMade: number;
}

// ─── Preference key mapping ───────────────────────────────────────────────────
// Maps DjState keys → flat Preferences keys (all valid, no dotted strings)

function loadDjState(): DjState {
  const g = storage.preferences.getPreferences;
  return {
    enabled:           (g('djEnabled')            ?? false) as boolean,
    mood:              (g('djMood')               ?? 'auto') as DjMood,
    crossfadeSec:      (g('djCrossfadeSec')       ?? 4) as number,
    loudnessNorm:      (g('djLoudnessNorm')       ?? true) as boolean,
    ttsEnabled:        (g('djTtsEnabled')         ?? true) as boolean,
    ttsVoice:          (g('djTtsVoice')           ?? 'default') as string,
    ttsRate:           (g('djTtsRate')            ?? 1.0) as number,
    ttsPitch:          (g('djTtsPitch')           ?? 1.0) as number,
    ttsVolume:         (g('djTtsVolume')          ?? 0.85) as number,
    announcementStyle: (g('djAnnouncementStyle')  ?? 'friendly') as AnnouncementStyle,
    announceOnEvery:   (g('djAnnounceOnEvery')    ?? 3) as number,
  };
}

function saveDjState(state: DjState) {
  const s = storage.preferences.setPreferences;
  s('djEnabled',           state.enabled);
  s('djMood',              state.mood);
  s('djCrossfadeSec',      state.crossfadeSec);
  s('djLoudnessNorm',      state.loudnessNorm);
  s('djTtsEnabled',        state.ttsEnabled);
  s('djTtsVoice',          state.ttsVoice);
  s('djTtsRate',           state.ttsRate);
  s('djTtsPitch',          state.ttsPitch);
  s('djTtsVolume',         state.ttsVolume);
  s('djAnnouncementStyle', state.announcementStyle);
  s('djAnnounceOnEvery',   state.announceOnEvery);
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MOOD_LABELS: Record<DjMood, { label: string; icon: string; desc: string }> = {
  auto:      { label: 'Auto',      icon: 'auto_awesome',   desc: 'AI picks based on your listening history' },
  chill:     { label: 'Chill',     icon: 'self_improvement', desc: 'Relaxed, calm, lo-fi vibes' },
  energetic: { label: 'Energetic', icon: 'bolt',           desc: 'Upbeat, fast-tempo tracks' },
  focus:     { label: 'Focus',     icon: 'psychology',     desc: 'Ambient, instrumental, minimal distractions' },
  party:     { label: 'Party',     icon: 'celebration',    desc: 'High energy, dance, crowd pleasers' },
  sad:       { label: 'Moody',     icon: 'nightlight',     desc: 'Emotional, reflective, slow' },
};

const STYLE_LABELS: Record<AnnouncementStyle, { label: string; desc: string }> = {
  minimal:  { label: 'Minimal',  desc: 'Just the song name and artist' },
  friendly: { label: 'Friendly', desc: 'Warm, conversational tone' },
  hype:     { label: 'Hype',     desc: 'Energetic, like a radio DJ' },
  trivia:   { label: 'Trivia',   desc: 'Fun facts about the track or artist' },
};

// ─── AI announcement generator ────────────────────────────────────────────────

async function generateAnnouncement(
  title: string,
  artist: string,
  style: AnnouncementStyle,
  prevTitle?: string,
  prevArtist?: string
): Promise<string> {
  try {
    const systemPrompt = `You are Nora, an AI DJ built into a music player.
Generate a short, natural spoken announcement to introduce an upcoming song.
Style: ${
  style === 'minimal'  ? 'Very brief — just name and artist, no extra fluff.' :
  style === 'friendly' ? 'Warm, conversational, like a friend recommending a song.' :
  style === 'hype'     ? 'Energetic and hype, like a club DJ or radio host.' :
  'Include one interesting fact about the song, album, or artist if you know one. Keep it brief.'
}
Keep it under 2 sentences. Vary your phrasing — do NOT always say "Up next".
Never reveal you are an AI. Speak naturally as if live on air.`;

    const userMsg = prevTitle
      ? `Transitioning from "${prevTitle}" by ${prevArtist} to "${title}" by ${artist}. Announce the new song.`
      : `Introduce "${title}" by ${artist}.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 120,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });
    const data = await response.json();
    const text = data?.content?.[0]?.text?.trim();
    return text || `${title} by ${artist}`;
  } catch {
    return `${title} by ${artist}`;
  }
}

// ─── TTS ──────────────────────────────────────────────────────────────────────

function speak(
  text: string,
  voice: string,
  rate: number,
  pitch: number,
  volume: number,
  onDone?: () => void
) {
  if (!window.speechSynthesis) { onDone?.(); return; }
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate = rate;
  utt.pitch = pitch;
  utt.volume = volume;
  if (voice !== 'default') {
    const v = window.speechSynthesis.getVoices().find((v) => v.name === voice);
    if (v) utt.voice = v;
  }
  utt.onend = () => onDone?.();
  utt.onerror = () => onDone?.();
  window.speechSynthesis.speak(utt);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ToggleSwitch({ checked, onChange, label, sublabel, icon }: {
  checked: boolean; onChange: (v: boolean) => void;
  label: string; sublabel?: string; icon?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-background-color-1 px-4 py-3 dark:bg-dark-background-color-1">
      <div className="flex items-center gap-3 min-w-0">
        {icon && <span className="material-icons-round text-xl text-font-color-black/40 dark:text-font-color-white/40">{icon}</span>}
        <div className="min-w-0">
          <p className="text-sm font-medium">{label}</p>
          {sublabel && <p className="text-xs text-font-color-black/45 dark:text-font-color-white/45">{sublabel}</p>}
        </div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-font-color-highlight dark:bg-dark-font-color-highlight' : 'bg-background-color-2 dark:bg-dark-background-color-2'}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-auto right-0.5' : 'left-0.5'}`} />
      </button>
    </div>
  );
}

function SliderRow({ label, value, min, max, step, onChange, format }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; format?: (v: number) => string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 text-xs text-font-color-black/55 dark:text-font-color-white/55">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-font-color-highlight dark:accent-dark-font-color-highlight" />
      <span className="w-12 text-right text-xs tabular-nums text-font-color-black/55 dark:text-font-color-white/55">
        {format ? format(value) : value}
      </span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function DjModePage() {
  const { t } = useTranslation();
  const currentSong = useStore(store, (s) => s.currentSongData);

  const [dj, setDjRaw] = useState<DjState>(loadDjState);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [stat, setStat] = useState<SessionStat>({ tracksPlayed: 0, startTime: Date.now(), announcementsMade: 0 });
  const [testText, setTestText] = useState('');
  const [previewPlaying, setPreviewPlaying] = useState(false);

  const prevSongRef = useRef<{ title: string; artist: string } | null>(null);
  const trackCountRef = useRef(0);

  const setDj = useCallback((patch: Partial<DjState>) => {
    setDjRaw((prev) => {
      const next = { ...prev, ...patch };
      saveDjState(next);
      return next;
    });
  }, []);

  useEffect(() => {
    const load = () => setVoices(window.speechSynthesis?.getVoices() ?? []);
    load();
    window.speechSynthesis?.addEventListener('voiceschanged', load);
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', load);
  }, []);

  useEffect(() => {
    if (!dj.enabled || !dj.ttsEnabled || !currentSong) return;

    const title = currentSong.title ?? '';
    const artist = Array.isArray(currentSong.artists)
      ? currentSong.artists.map((a: any) => a.name).join(', ')
      : ((currentSong.artists as any)?.name ?? '');

    if (prevSongRef.current?.title === title && prevSongRef.current?.artist === artist) return;

    trackCountRef.current += 1;
    setStat((s) => ({ ...s, tracksPlayed: s.tracksPlayed + 1 }));

    if (trackCountRef.current % dj.announceOnEvery !== 0 && trackCountRef.current !== 1) {
      prevSongRef.current = { title, artist };
      return;
    }

    const prev = prevSongRef.current;
    prevSongRef.current = { title, artist };

    setIsGenerating(true);
    generateAnnouncement(title, artist, dj.announcementStyle, prev?.title, prev?.artist).then((text) => {
      setIsGenerating(false);
      setAnnouncement(text);
      setIsSpeaking(true);
      setStat((s) => ({ ...s, announcementsMade: s.announcementsMade + 1 }));
      speak(text, dj.ttsVoice, dj.ttsRate, dj.ttsPitch, dj.ttsVolume, () => setIsSpeaking(false));
    });
  }, [currentSong, dj.enabled, dj.ttsEnabled, dj.announcementStyle, dj.announceOnEvery,
      dj.ttsVoice, dj.ttsRate, dj.ttsPitch, dj.ttsVolume]);

  const skipAnnouncement = useCallback(() => {
    window.speechSynthesis?.cancel();
    setIsSpeaking(false);
  }, []);

  const handlePreview = useCallback(() => {
    const text = testText || 'Now playing — a great track to vibe to. Sit back and enjoy.';
    setPreviewPlaying(true);
    speak(text, dj.ttsVoice, dj.ttsRate, dj.ttsPitch, dj.ttsVolume, () => setPreviewPlaying(false));
  }, [testText, dj.ttsVoice, dj.ttsRate, dj.ttsPitch, dj.ttsVolume]);

  const sessionDuration = Math.round((Date.now() - stat.startTime) / 60_000);

  return (
    <MainContainer className="appear-from-bottom text-font-color-black dark:text-font-color-white">
      <TitleContainer title={t('djModePage.title')} />

      <div className="mr-8 flex flex-col gap-5">

        {/* Master toggle */}
        <div className={`flex items-center justify-between rounded-2xl px-5 py-4 transition-colors ${dj.enabled ? 'bg-font-color-highlight text-white dark:bg-dark-font-color-highlight dark:text-font-color-black' : 'bg-background-color-1 dark:bg-dark-background-color-1'}`}>
          <div className="flex items-center gap-3">
            <span className="material-icons-round text-2xl">radio</span>
            <div>
              <p className="font-semibold text-base">DJ Mode</p>
              <p className={`text-xs ${dj.enabled ? 'opacity-75' : 'text-font-color-black/45 dark:text-font-color-white/45'}`}>
                {dj.enabled ? 'Active — AI DJ is controlling your session' : 'Off — enable to start your AI DJ session'}
              </p>
            </div>
          </div>
          <button onClick={() => setDj({ enabled: !dj.enabled })}
            className={`relative h-7 w-14 shrink-0 rounded-full transition-colors ${dj.enabled ? 'bg-white/30' : 'bg-background-color-2 dark:bg-dark-background-color-2'}`}>
            <span className={`absolute top-1 h-5 w-5 rounded-full shadow transition-all ${dj.enabled ? 'left-auto right-1 bg-white' : 'left-1 bg-white/70'}`} />
          </button>
        </div>

        {/* Announcement banner */}
        {(isGenerating || isSpeaking || announcement) && dj.enabled && (
          <div className="flex items-start gap-3 rounded-xl bg-font-color-highlight/10 px-4 py-3 dark:bg-dark-font-color-highlight/10">
            <span className={`material-icons-round text-xl text-font-color-highlight dark:text-dark-font-color-highlight ${isSpeaking || isGenerating ? 'animate-pulse' : ''}`}>record_voice_over</span>
            <p className="flex-1 text-sm italic text-font-color-highlight dark:text-dark-font-color-highlight">
              "{isGenerating ? '…generating announcement…' : announcement}"
            </p>
            {(isSpeaking || isGenerating) && (
              <button onClick={skipAnnouncement} title="Skip" className="shrink-0 rounded-lg p-1 text-font-color-highlight/60 hover:text-font-color-highlight">
                <span className="material-icons-round text-base leading-none">skip_next</span>
              </button>
            )}
          </div>
        )}

        {/* Session stats */}
        {dj.enabled && (
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: 'music_note',        label: 'Tracks played',  value: stat.tracksPlayed },
              { icon: 'record_voice_over', label: 'Announcements',  value: stat.announcementsMade },
              { icon: 'schedule',          label: 'Session time',   value: `${sessionDuration}m` },
            ].map(({ icon, label, value }) => (
              <div key={label} className="flex flex-col items-center gap-1 rounded-xl bg-background-color-1 py-3 dark:bg-dark-background-color-1">
                <span className="material-icons-round text-2xl text-font-color-highlight dark:text-dark-font-color-highlight">{icon}</span>
                <span className="text-lg font-semibold tabular-nums">{value}</span>
                <span className="text-xs text-font-color-black/45 dark:text-font-color-white/45">{label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Mood */}
        <div>
          <p className="mb-2 text-sm font-medium text-font-color-black/65 dark:text-font-color-white/65">Mood</p>
          <div className="grid grid-cols-3 gap-2">
            {(Object.entries(MOOD_LABELS) as [DjMood, typeof MOOD_LABELS[DjMood]][]).map(([key, { label, icon, desc }]) => (
              <button key={key} onClick={() => setDj({ mood: key })} title={desc}
                className={`flex flex-col items-center gap-1.5 rounded-xl px-2 py-3 text-center transition-colors ${dj.mood === key ? 'bg-font-color-highlight text-white dark:bg-dark-font-color-highlight dark:text-font-color-black' : 'bg-background-color-1 text-font-color-black/65 hover:bg-background-color-2 dark:bg-dark-background-color-1 dark:text-font-color-white/65 dark:hover:bg-dark-background-color-2'}`}>
                <span className="material-icons-round text-xl leading-none">{icon}</span>
                <span className="text-xs font-medium">{label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Playback */}
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-font-color-black/65 dark:text-font-color-white/65">Playback</p>
          <ToggleSwitch icon="merge" label="Crossfade" sublabel={`${dj.crossfadeSec}s overlap between tracks`}
            checked={dj.crossfadeSec > 0} onChange={(v) => setDj({ crossfadeSec: v ? 4 : 0 })} />
          {dj.crossfadeSec > 0 && (
            <div className="rounded-xl bg-background-color-1 px-4 py-3 dark:bg-dark-background-color-1">
              <SliderRow label="Crossfade" value={dj.crossfadeSec} min={1} max={12} step={1}
                onChange={(v) => setDj({ crossfadeSec: v })} format={(v) => `${v}s`} />
            </div>
          )}
          <ToggleSwitch icon="volume_up" label="Loudness normalisation" sublabel="Keep all tracks at consistent volume"
            checked={dj.loudnessNorm} onChange={(v) => setDj({ loudnessNorm: v })} />
        </div>

        {/* Announcements */}
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-font-color-black/65 dark:text-font-color-white/65">Announcements</p>
          <ToggleSwitch icon="record_voice_over" label="Voice announcements"
            sublabel="AI-generated commentary spoken between tracks"
            checked={dj.ttsEnabled} onChange={(v) => setDj({ ttsEnabled: v })} />

          {dj.ttsEnabled && (
            <div className="flex flex-col gap-4 rounded-xl bg-background-color-1 px-4 py-4 dark:bg-dark-background-color-1">
              {/* Style */}
              <div>
                <p className="mb-2 text-xs font-medium text-font-color-black/55 dark:text-font-color-white/55">Style</p>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.entries(STYLE_LABELS) as [AnnouncementStyle, typeof STYLE_LABELS[AnnouncementStyle]][]).map(([key, { label, desc }]) => (
                    <button key={key} onClick={() => setDj({ announcementStyle: key })} title={desc}
                      className={`rounded-lg px-3 py-2 text-left text-xs transition-colors ${dj.announcementStyle === key ? 'bg-font-color-highlight text-white dark:bg-dark-font-color-highlight dark:text-font-color-black' : 'bg-background-color-2 text-font-color-black/65 hover:bg-background-color-2/80 dark:bg-dark-background-color-2 dark:text-font-color-white/65'}`}>
                      <span className="font-medium">{label}</span>
                      <p className="mt-0.5 text-[10px] opacity-65 leading-tight">{desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <SliderRow label="Announce every" value={dj.announceOnEvery} min={1} max={10} step={1}
                onChange={(v) => setDj({ announceOnEvery: v })} format={(v) => `${v} tracks`} />

              {voices.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-font-color-black/55 dark:text-font-color-white/55">Voice</p>
                  <select value={dj.ttsVoice} onChange={(e) => setDj({ ttsVoice: e.target.value })}
                    className="w-full rounded-lg bg-background-color-2 px-3 py-2 text-sm dark:bg-dark-background-color-2 outline-none">
                    <option value="default">Default voice</option>
                    {voices.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}
                  </select>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <SliderRow label="Speed"  value={dj.ttsRate}   min={0.5} max={2}   step={0.1}  onChange={(v) => setDj({ ttsRate: v })}   format={(v) => `${v.toFixed(1)}×`} />
                <SliderRow label="Pitch"  value={dj.ttsPitch}  min={0.5} max={2}   step={0.1}  onChange={(v) => setDj({ ttsPitch: v })}  format={(v) => `${v.toFixed(1)}`} />
                <SliderRow label="Volume" value={dj.ttsVolume} min={0.1} max={1}   step={0.05} onChange={(v) => setDj({ ttsVolume: v })} format={(v) => `${Math.round(v * 100)}%`} />
              </div>

              <div className="flex gap-2">
                <input value={testText} onChange={(e) => setTestText(e.target.value)}
                  placeholder="Type something to preview…"
                  className="flex-1 rounded-lg bg-background-color-2 px-3 py-1.5 text-sm outline-none dark:bg-dark-background-color-2" />
                <button onClick={handlePreview} disabled={previewPlaying}
                  className="flex items-center gap-1.5 rounded-lg bg-font-color-highlight px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-dark-font-color-highlight dark:text-font-color-black">
                  <span className="material-icons-round text-sm leading-none">{previewPlaying ? 'volume_up' : 'play_arrow'}</span>
                  {previewPlaying ? 'Speaking…' : 'Preview'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex items-start gap-2.5 rounded-xl bg-background-color-1 px-4 py-3 text-xs text-font-color-black/45 dark:bg-dark-background-color-1 dark:text-font-color-white/45">
          <span className="material-icons-round text-sm leading-tight">info</span>
          <p>DJ announcements are generated using on-device AI and spoken using your system's text-to-speech engine. No audio data leaves your device.</p>
        </div>
      </div>
    </MainContainer>
  );
}
