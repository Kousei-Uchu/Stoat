import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import Checkbox from '../../Checkbox';
import storage from '../../../utils/localStorage';

export default function DownloadSettings() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [enabled, setEnabled] = useState(() =>
    storage.preferences.getPreferences('enableDownloaderFeatures') ?? true
  );
  const [downloadFolder, setDownloadFolder] = useState<string>(
    storage.preferences.getPreferences('downloadFolder') || ''
  );
  const [defaultFormat, setDefaultFormat] = useState<string>(
    storage.preferences.getPreferences('defaultDownloadFormat') || 'mp3_320'
  );
  const [downloadLyrics, setDownloadLyrics] = useState(
    storage.preferences.getPreferences('downloadLyricsDefault') ?? true
  );
  const [enableCrossfade, setEnableCrossfade] = useState(
    storage.preferences.getPreferences('enableCrossfade') ?? false
  );
  const [crossfadeDuration, setCrossfadeDuration] = useState(
    storage.preferences.getPreferences('crossfadeDuration') ?? 5
  );
  const [enableLoudnessNormalization, setEnableLoudnessNormalization] = useState(
    storage.preferences.getPreferences('enableLoudnessNormalization') ?? false
  );

  const saveFolder = () => {
    storage.preferences.setPreferences('downloadFolder', downloadFolder);
  };

  const saveFormat = () => {
    storage.preferences.setPreferences('defaultDownloadFormat', defaultFormat);
    storage.preferences.setPreferences('downloadLyricsDefault', downloadLyrics);
  };

  const savePlayback = () => {
    storage.preferences.setPreferences('enableCrossfade', enableCrossfade);
    storage.preferences.setPreferences('crossfadeDuration', crossfadeDuration);
    storage.preferences.setPreferences('enableLoudnessNormalization', enableLoudnessNormalization);
  };

  const FORMATS: Record<string, string> = {
    mp3_320: 'MP3 320kbps',
    mp3_192: 'MP3 192kbps',
    mp3_128: 'MP3 128kbps',
    flac: 'FLAC (lossless)',
    wav: 'WAV',
    ogg: 'OGG Vorbis',
    aac: 'AAC',
    m4a: 'M4A',
    opus: 'Opus',
  };

  return (
    <li className="settings-section" id="download-settings-container">
      <h3 className="text-lg font-medium">{t('settingsPage.downloads' as any) || 'Downloads'}</h3>
      <p className="mt-1 text-sm text-font-color-black/55 dark:text-font-color-white/55">
        Configure how Nora downloads and saves music from the internet.
      </p>

      {/* Enable / disable */}
      <div className="mt-4">
            <Checkbox
              id="enableDownloaderFeatures"
              labelContent={t('settingsPage.enableDownloader' as any) || 'Enable downloader'}
          isChecked={enabled}
          checkedStateUpdateFunction={(state) => {
            setEnabled(state);
            storage.preferences.setPreferences('enableDownloaderFeatures', state);
          }}
        />
        <p className="mt-1 ml-6 text-xs text-font-color-black/45 dark:text-font-color-white/45">
          Shows the Download tab in the sidebar. Uses yt-dlp (auto-downloaded on first use, ~10 MB).
        </p>
      </div>

      {enabled && (
        <>
          {/* Download folder */}
          <div className="mt-5">
            <label className="block text-sm font-medium mb-1">
              {t('settingsPage.downloadFolder' as any) || 'Download folder'}
            </label>
            <p className="mb-2 text-xs text-font-color-black/45 dark:text-font-color-white/45">
              Where downloaded songs are saved. Leave blank to use the system Music folder.
            </p>
            <div className="flex gap-2">
              <input
                value={downloadFolder}
                onChange={(e) => setDownloadFolder(e.target.value)}
                className="flex-1 rounded-lg border border-background-color-1 bg-background-color-2 px-3 py-2 text-sm outline-none focus:border-font-color-highlight/40 dark:border-dark-background-color-1 dark:bg-dark-background-color-2 dark:focus:border-dark-font-color-highlight/40"
                placeholder="e.g. /Users/you/Music/Downloads"
              />
              <button
                onClick={saveFolder}
                className="rounded-lg bg-font-color-highlight px-4 py-2 text-sm font-medium text-white dark:bg-dark-font-color-highlight dark:text-font-color-black"
              >
                Save
              </button>
            </div>
          </div>

          {/* Default format */}
          <div className="mt-5">
            <label className="block text-sm font-medium mb-1">
              Default format
            </label>
            <p className="mb-2 text-xs text-font-color-black/45 dark:text-font-color-white/45">
              The audio format used when downloading from the Download page.
            </p>
            <div className="flex items-center gap-3">
              <select
                value={defaultFormat}
                onChange={(e) => setDefaultFormat(e.target.value)}
                className="flex-1 rounded-lg border border-background-color-1 bg-background-color-2 px-3 py-2 text-sm outline-none dark:border-dark-background-color-1 dark:bg-dark-background-color-2"
              >
                {Object.entries(FORMATS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
            <div className="mt-3">
              <Checkbox
                id="downloadLyricsDefault"
                labelContent="Download lyrics (.lrc) by default"
                isChecked={downloadLyrics}
                checkedStateUpdateFunction={(state) => setDownloadLyrics(state)}
              />
            </div>
            <div className="mt-2">
              <button
                onClick={saveFormat}
                className="rounded-lg bg-font-color-highlight px-4 py-2 text-sm font-medium text-white dark:bg-dark-font-color-highlight dark:text-font-color-black"
              >
                Save defaults
              </button>
            </div>
          </div>

          {/* Playback */}
          <div className="mt-5 border-t border-background-color-1 pt-4 dark:border-dark-background-color-1">
            <p className="text-sm font-medium mb-3">Playback enhancements</p>
            <div className="flex flex-col gap-3">
              <Checkbox
                id="enableCrossfade"
                labelContent={t('settingsPage.enableCrossfade' as any) || 'Enable crossfade between tracks'}
                isChecked={enableCrossfade}
                checkedStateUpdateFunction={(state) => setEnableCrossfade(state)}
              />
              {enableCrossfade && (
                <div className="ml-6 flex items-center gap-3">
                  <label className="text-xs text-font-color-black/55 dark:text-font-color-white/55 w-28">
                    Crossfade duration
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={12}
                    step={1}
                    value={crossfadeDuration}
                    onChange={(e) => setCrossfadeDuration(Number(e.target.value))}
                    className="flex-1 accent-font-color-highlight dark:accent-dark-font-color-highlight"
                  />
                  <span className="w-10 text-right text-xs tabular-nums text-font-color-black/55 dark:text-font-color-white/55">
                    {crossfadeDuration}s
                  </span>
                </div>
              )}
              <Checkbox
                id="enableLoudnessNormalization"
                labelContent={
                  t('settingsPage.enableLoudnessNormalization' as any) || 'Enable loudness normalisation'
                }
                isChecked={enableLoudnessNormalization}
                checkedStateUpdateFunction={(state) => setEnableLoudnessNormalization(state)}
              />
            </div>
            <div className="mt-3">
              <button
                onClick={savePlayback}
                className="rounded-lg bg-font-color-highlight px-4 py-2 text-sm font-medium text-white dark:bg-dark-font-color-highlight dark:text-font-color-black"
              >
                Save
              </button>
            </div>
          </div>

          {/* DJ Mode link */}
          <div className="mt-5 border-t border-background-color-1 pt-4 dark:border-dark-background-color-1">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">DJ Mode</p>
                <p className="mt-0.5 text-xs text-font-color-black/45 dark:text-font-color-white/45">
                  AI-generated voice announcements, crossfade, mood-based queuing
                </p>
              </div>
              <button
                onClick={() => navigate({ to: '/main-player/dj' })}
                className="flex items-center gap-1.5 rounded-lg bg-background-color-1 px-3 py-2 text-sm font-medium transition-colors hover:bg-background-color-2 dark:bg-dark-background-color-1 dark:hover:bg-dark-background-color-2"
              >
                <span className="material-icons-round text-base leading-none">radio</span>
                Open DJ Mode
              </button>
            </div>
          </div>
        </>
      )}
    </li>
  );
}
