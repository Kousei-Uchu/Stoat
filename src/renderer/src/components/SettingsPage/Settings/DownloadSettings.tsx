import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import Checkbox from '../../Checkbox';
import storage from '../../../utils/localStorage';
import { useEffect, useState } from 'react';
import { isPluginEnabled, PLUGIN_REGISTRY_CHANGED_EVENT } from '../../../plugins/registry';

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
    (storage.preferences.getPreferences('defaultDownloadFormat') as string) || 'mp3_320'
  );
  const [downloadLyrics, setDownloadLyrics] = useState(
    (storage.preferences.getPreferences('downloadLyricsDefault') as boolean) ?? true
  );
  const [djPluginEnabled, setDjPluginEnabled] = useState(
    () => isPluginEnabled('dev.nora.dj')
  );

  useEffect(() => {
    const updatePluginStatus = () => setDjPluginEnabled(isPluginEnabled('dev.nora.dj'));
    window.addEventListener(PLUGIN_REGISTRY_CHANGED_EVENT, updatePluginStatus);
    return () => window.removeEventListener(PLUGIN_REGISTRY_CHANGED_EVENT, updatePluginStatus);
  }, []);

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
      <h3 className="text-lg font-medium">{t('settingsPage.downloads') || 'Downloads'}</h3>
      <p className="mt-1 text-sm text-font-color-black/55 dark:text-font-color-white/55">
        Configure how Nora downloads and saves music from the internet.
      </p>

      <div className="mt-4">
        <Checkbox
          id="enableDownloaderFeatures"
          labelContent={t('settingsPage.enableDownloader') || 'Enable downloader'}
          isChecked={enabled}
          checkedStateUpdateFunction={(state) => {
            setEnabled(state);
            storage.preferences.setPreferences('enableDownloaderFeatures', state);
          }}
        />
        <p className="mt-1 ml-6 text-xs text-font-color-black/45 dark:text-font-color-white/45">
          Shows the Download tab in the sidebar. yt-dlp is auto-downloaded on first use (~10 MB).
        </p>
      </div>

      {enabled && (
        <>
          <div className="mt-5">
            <label className="block text-sm font-medium mb-1">
              {t('settingsPage.downloadFolder') || 'Download folder'}
            </label>
            <p className="mb-2 text-xs text-font-color-black/45 dark:text-font-color-white/45">
              Where downloaded songs are saved. Leave blank to use the system Music folder.
            </p>
            <input
              value={downloadFolder}
              onChange={(e) => {
                setDownloadFolder(e.target.value);
                storage.preferences.setPreferences('downloadFolder', e.target.value);
              }}
              className="w-full rounded-lg border border-background-color-1 bg-background-color-2 px-3 py-2 text-sm outline-none focus:border-font-color-highlight/40 dark:border-dark-background-color-1 dark:bg-dark-background-color-2 dark:focus:border-dark-font-color-highlight/40"
              placeholder="e.g. /Users/you/Music/Downloads"
            />
          </div>

          <div className="mt-5">
            <label className="block text-sm font-medium mb-1">Default format</label>
            <select
              value={defaultFormat}
              onChange={(e) => {
                setDefaultFormat(e.target.value);
                storage.preferences.setPreferences('defaultDownloadFormat', e.target.value);
              }}
              className="w-full rounded-lg border border-background-color-1 bg-background-color-2 px-3 py-2 text-sm outline-none dark:border-dark-background-color-1 dark:bg-dark-background-color-2"
            >
              {Object.entries(FORMATS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <div className="mt-3">
              <Checkbox
                id="downloadLyricsDefault"
                labelContent="Download lyrics (.lrc) by default"
                isChecked={downloadLyrics}
                checkedStateUpdateFunction={(state) => {
                  setDownloadLyrics(state);
                  storage.preferences.setPreferences('downloadLyricsDefault', state as any);
                }}
              />
            </div>
          </div>

          {djPluginEnabled && (
            <div className="mt-5 border-t border-background-color-1 pt-4 dark:border-dark-background-color-1">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">DJ Mode</p>
                  <p className="mt-0.5 text-xs text-font-color-black/45 dark:text-font-color-white/45">
                    AI-generated voice announcements and mood-based sessions
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
          )}
        </>
      )}
    </li>
  );
}
