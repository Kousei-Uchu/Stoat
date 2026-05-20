import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Checkbox from '../../Checkbox';
import storage from '../../../utils/localStorage';

export default function DownloadSettings() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(() =>
    storage.preferences.getPreferences('enableDownloaderFeatures') ?? true
  );
  const [downloadFolder, setDownloadFolder] = useState<string>(
    storage.preferences.getPreferences('downloadFolder') || ''
  );
  const [youtubeAuth, setYoutubeAuth] = useState(
    storage.preferences.getPreferences('enableYoutubeAuth') ?? false
  );
  const [spotifyAuth, setSpotifyAuth] = useState(
    storage.preferences.getPreferences('enableSpotifyAuth') ?? false
  );
  const [soundcloudAuth, setSoundcloudAuth] = useState(
    storage.preferences.getPreferences('enableSoundcloudAuth') ?? false
  );
  const [youtubeApiKey, setYoutubeApiKey] = useState(
    storage.preferences.getPreferences('youtubeApiKey') || ''
  );
  const [spotifyClientId, setSpotifyClientId] = useState(
    storage.preferences.getPreferences('spotifyClientId') || ''
  );
  const [spotifyClientSecret, setSpotifyClientSecret] = useState(
    storage.preferences.getPreferences('spotifyClientSecret') || ''
  );
  const [soundcloudClientId, setSoundcloudClientId] = useState(
    storage.preferences.getPreferences('soundcloudClientId') || ''
  );
  const [enableDjMode, setEnableDjMode] = useState(
    storage.preferences.getPreferences('enableDjMode') ?? false
  );
  const [djProvider, setDjProvider] = useState(
    storage.preferences.getPreferences('djProvider') || 'none'
  );
  const [djModel, setDjModel] = useState(
    storage.preferences.getPreferences('djModel') || 'local'
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

  useEffect(() => {
    storage.preferences.setPreferences('enableDownloaderFeatures', enabled);
  }, [enabled]);

  const saveFolder = () => {
    storage.preferences.setPreferences('downloadFolder', downloadFolder);
  };

  const saveCredentials = () => {
    storage.preferences.setPreferences('youtubeApiKey', youtubeApiKey);
    storage.preferences.setPreferences('spotifyClientId', spotifyClientId);
    storage.preferences.setPreferences('spotifyClientSecret', spotifyClientSecret);
    storage.preferences.setPreferences('soundcloudClientId', soundcloudClientId);
  };

  const saveDjSettings = () => {
    storage.preferences.setPreferences('enableDjMode', enableDjMode);
    storage.preferences.setPreferences('djProvider', djProvider);
    storage.preferences.setPreferences('djModel', djModel);
    storage.preferences.setPreferences('enableCrossfade', enableCrossfade);
    storage.preferences.setPreferences('crossfadeDuration', crossfadeDuration);
    storage.preferences.setPreferences('enableLoudnessNormalization', enableLoudnessNormalization);
  };

  return (
    <li className="settings-section">
      <h3 className="text-lg font-medium">{t('settingsPage.downloads') || 'Downloads'}</h3>

      <div className="mt-2">
        <Checkbox
          id="enableDownloaderFeatures"
          labelContent={t('settingsPage.enableDownloader') || 'Enable downloader features'}
          isChecked={enabled}
          checkedStateUpdateFunction={(state) => {
            setEnabled(state);
            storage.preferences.setPreferences('enableDownloaderFeatures', state);
          }}
        />
      </div>

      <div className="mt-4">
        <label className="block mb-1">{t('settingsPage.downloadFolder') || 'Download folder'}</label>
        <input
          value={downloadFolder}
          onChange={(e) => setDownloadFolder(e.target.value)}
          className="w-full p-2 rounded border"
          placeholder="Leave blank to use system music folder"
        />
        <div className="mt-2">
          <button className="btn" onClick={saveFolder}>
            {t('save') || 'Save'}
          </button>
        </div>
      </div>

      <div className="mt-6">
        <div className="text-sm font-medium">{t('settingsPage.authCredentials') || 'Credentials'}</div>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="block mb-1">YouTube API Key</span>
            <input
              value={youtubeApiKey}
              onChange={(e) => setYoutubeApiKey(e.target.value)}
              className="w-full p-2 rounded border"
              placeholder="YouTube API Key"
            />
          </label>
          <label className="block">
            <span className="block mb-1">Spotify Client ID</span>
            <input
              value={spotifyClientId}
              onChange={(e) => setSpotifyClientId(e.target.value)}
              className="w-full p-2 rounded border"
              placeholder="Spotify Client ID"
            />
          </label>
          <label className="block">
            <span className="block mb-1">Spotify Client Secret</span>
            <input
              value={spotifyClientSecret}
              onChange={(e) => setSpotifyClientSecret(e.target.value)}
              className="w-full p-2 rounded border"
              placeholder="Spotify Client Secret"
              type="password"
            />
          </label>
          <label className="block">
            <span className="block mb-1">SoundCloud Client ID</span>
            <input
              value={soundcloudClientId}
              onChange={(e) => setSoundcloudClientId(e.target.value)}
              className="w-full p-2 rounded border"
              placeholder="SoundCloud Client ID"
            />
          </label>
        </div>
        <div className="mt-3">
          <button className="btn" onClick={saveCredentials}>
            {t('save') || 'Save Credentials'}
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-2">
        <Checkbox
          id="youtubeAuthToggle"
          labelContent={t('settingsPage.enableYoutubeAuth') || 'Enable YouTube auth features'}
          isChecked={youtubeAuth}
          checkedStateUpdateFunction={(state) => {
            setYoutubeAuth(state);
            storage.preferences.setPreferences('enableYoutubeAuth', state);
          }}
        />
        <Checkbox
          id="spotifyAuthToggle"
          labelContent={t('settingsPage.enableSpotifyAuth') || 'Enable Spotify auth features'}
          isChecked={spotifyAuth}
          checkedStateUpdateFunction={(state) => {
            setSpotifyAuth(state);
            storage.preferences.setPreferences('enableSpotifyAuth', state);
          }}
        />
        <Checkbox
          id="soundcloudAuthToggle"
          labelContent={t('settingsPage.enableSoundcloudAuth') || 'Enable SoundCloud auth features'}
          isChecked={soundcloudAuth}
          checkedStateUpdateFunction={(state) => {
            setSoundcloudAuth(state);
            storage.preferences.setPreferences('enableSoundcloudAuth', state);
          }}
        />
      </div>

      <div className="mt-6 border-t border-border-color pt-4">
        <div className="text-sm font-medium">{t('settingsPage.djMode') || 'DJ Mode'}</div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Checkbox
            id="enableDjMode"
            labelContent={t('settingsPage.enableDjMode') || 'Enable DJ mode'}
            isChecked={enableDjMode}
            checkedStateUpdateFunction={(state) => setEnableDjMode(state)}
          />
          <label className="block">
            <span className="block mb-1">{t('settingsPage.djProvider') || 'AI provider'}</span>
            <select
              value={djProvider}
              onChange={(e) => setDjProvider(e.target.value)}
              className="w-full p-2 rounded border"
            >
              <option value="none">None</option>
              <option value="local">On-device</option>
              <option value="cloud">Cloud</option>
            </select>
          </label>
          <label className="block">
            <span className="block mb-1">{t('settingsPage.djModel') || 'Model'}</span>
            <input
              value={djModel}
              onChange={(e) => setDjModel(e.target.value)}
              className="w-full p-2 rounded border"
              placeholder="e.g. local-llm or cloud-llm"
            />
          </label>
          <Checkbox
            id="enableCrossfade"
            labelContent={t('settingsPage.enableCrossfade') || 'Enable crossfade'}
            isChecked={enableCrossfade}
            checkedStateUpdateFunction={(state) => setEnableCrossfade(state)}
          />
          <label className="block">
            <span className="block mb-1">{t('settingsPage.crossfadeDuration') || 'Crossfade duration (seconds)'}</span>
            <input
              type="number"
              value={crossfadeDuration}
              min={0}
              onChange={(e) => setCrossfadeDuration(Number(e.target.value))}
              className="w-full p-2 rounded border"
            />
          </label>
          <Checkbox
            id="enableLoudnessNormalization"
            labelContent={
              t('settingsPage.enableLoudnessNormalization') || 'Enable loudness normalization'
            }
            isChecked={enableLoudnessNormalization}
            checkedStateUpdateFunction={(state) => setEnableLoudnessNormalization(state)}
          />
        </div>
        <div className="mt-3">
          <button className="btn" onClick={saveDjSettings}>
            {t('save') || 'Save DJ Settings'}
          </button>
        </div>
      </div>
    </li>
  );
}
