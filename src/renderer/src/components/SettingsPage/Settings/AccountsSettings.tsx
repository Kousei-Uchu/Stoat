import { queryClient } from '@renderer/index';
import { settingsQuery } from '@renderer/queries/settings';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import LastFMIcon from '../../../assets/images/webp/last-fm-logo.webp';
import Button from '../../Button';
import Checkbox from '../../Checkbox';

const AccountsSettings = () => {
  const { data: userSettings } = useQuery(settingsQuery.all);
  const { t } = useTranslation();

  const isLastFmConnected = useMemo(
    () => !!userSettings?.lastFmSessionKey,
    [userSettings?.lastFmSessionKey]
  );

  // API credentials — stored in DB, editable here
  const [discordClientId, setDiscordClientId] = useState('');
  const [spotifyClientId, setSpotifyClientId] = useState('');
  const [spotifyClientSecret, setSpotifyClientSecret] = useState('');

  useEffect(() => {
    if (!userSettings) return;
    setDiscordClientId(userSettings.discordClientId ?? '');
    setSpotifyClientId(userSettings.spotifyClientId ?? '');
    setSpotifyClientSecret(userSettings.spotifyClientSecret ?? '');
  }, [userSettings]);

  const saveCredential = (key: string, value: string) => {
    window.api.settings.saveUserSettings({ [key]: value || null } as any).then(() => {
      queryClient.invalidateQueries(settingsQuery.all);
    });
  };

  const { mutate: updateDiscordRpcState } = useMutation({
    mutationFn: (enableDiscordRpc: boolean) =>
      window.api.settings.updateDiscordRpcState(enableDiscordRpc),
    onSettled: () => queryClient.invalidateQueries(settingsQuery.all)
  });

  const { mutate: updateSongScrobblingToLastFMState } = useMutation({
    mutationFn: (enableScrobbling: boolean) =>
      window.api.settings.updateSongScrobblingToLastFMState(enableScrobbling),
    onSettled: () => queryClient.invalidateQueries(settingsQuery.all)
  });

  const { mutate: updateSongFavoritesToLastFMState } = useMutation({
    mutationFn: (enableFavorites: boolean) =>
      window.api.settings.updateSongFavoritesToLastFMState(enableFavorites),
    onSettled: () => queryClient.invalidateQueries(settingsQuery.all)
  });

  const { mutate: updateSendNowPlayingSongDataToLastFMState } = useMutation({
    mutationFn: (enableNowPlaying: boolean) =>
      window.api.settings.updateNowPlayingSongDataToLastFMState(enableNowPlaying),
    onSettled: () => queryClient.invalidateQueries(settingsQuery.all)
  });

  return (
    <li
      className="main-container startup-settings-container mb-16"
      id="accounts-settings-container"
    >
      <div className="title-container text-font-color-highlight dark:text-dark-font-color-highlight mt-1 mb-4 flex items-center text-2xl font-medium">
        <span className="material-icons-round-outlined mr-2">account_circle</span>
        {t('settingsPage.accounts')}
      </div>
      <ul className="marker:bg-background-color-3 dark:marker:bg-background-color-3 list-disc pl-6">

        {/* ── API Credentials ── */}
        <li className="api-credentials mb-8">
          <p className="mb-1 font-semibold">API Credentials</p>
          <p className="description mb-4">
            Configure service credentials here — no .env file needed. Leave blank to use
            anonymous access (Spotify) or disable the feature (Discord).
          </p>

          {/* Discord */}
          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium">Discord Application Client ID</label>
            <p className="mb-2 text-xs text-font-color-black/45 dark:text-font-color-white/45">
              Get yours at{' '}
              <a
                href="https://discord.com/developers/applications"
                target="_blank"
                rel="noreferrer"
                className="text-font-color-highlight dark:text-dark-font-color-highlight underline"
              >
                discord.com/developers
              </a>
              . Required for Discord Rich Presence. Without it, RPC is silently disabled.
            </p>
            <input
              type="text"
              value={discordClientId}
              onChange={(e) => setDiscordClientId(e.target.value)}
              onBlur={(e) => saveCredential('discordClientId', e.target.value)}
              placeholder="e.g. 123456789012345678"
              className="w-full rounded-lg border border-background-color-1 bg-background-color-2 px-3 py-2 text-sm outline-none focus:border-font-color-highlight/40 dark:border-dark-background-color-1 dark:bg-dark-background-color-2 dark:focus:border-dark-font-color-highlight/40"
            />
          </div>

          {/* Spotify Client ID */}
          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium">Spotify Client ID</label>
            <p className="mb-2 text-xs text-font-color-black/45 dark:text-font-color-white/45">
              Optional. Without credentials, Nora uses anonymous Spotify access. With credentials,
              you get higher rate limits via the official API. Get yours at{' '}
              <a
                href="https://developer.spotify.com/dashboard"
                target="_blank"
                rel="noreferrer"
                className="text-font-color-highlight dark:text-dark-font-color-highlight underline"
              >
                developer.spotify.com
              </a>
              .
            </p>
            <input
              type="text"
              value={spotifyClientId}
              onChange={(e) => setSpotifyClientId(e.target.value)}
              onBlur={(e) => saveCredential('spotifyClientId', e.target.value)}
              placeholder="e.g. a1b2c3d4e5f6..."
              className="w-full rounded-lg border border-background-color-1 bg-background-color-2 px-3 py-2 text-sm outline-none focus:border-font-color-highlight/40 dark:border-dark-background-color-1 dark:bg-dark-background-color-2 dark:focus:border-dark-font-color-highlight/40"
            />
          </div>

          {/* Spotify Client Secret */}
          <div className="mb-4">
            <label className="mb-1 block text-sm font-medium">Spotify Client Secret</label>
            <input
              type="password"
              value={spotifyClientSecret}
              onChange={(e) => setSpotifyClientSecret(e.target.value)}
              onBlur={(e) => saveCredential('spotifyClientSecret', e.target.value)}
              placeholder="••••••••••••••••••••••••••••••••"
              className="w-full rounded-lg border border-background-color-1 bg-background-color-2 px-3 py-2 text-sm outline-none focus:border-font-color-highlight/40 dark:border-dark-background-color-1 dark:bg-dark-background-color-2 dark:focus:border-dark-font-color-highlight/40"
            />
          </div>

          <p className="text-xs text-font-color-black/40 dark:text-font-color-white/40">
            Changes save automatically when you leave each field.
          </p>
        </li>

        {/* ── Discord RPC ── */}
        <li className="discord-rpc-integration mb-4">
          <div className="description">{t('settingsPage.enableDiscordRpcDescription')}</div>
          <Checkbox
            id="enableDiscordRpc"
            isChecked={userSettings?.enableDiscordRPC ?? false}
            checkedStateUpdateFunction={(state) => updateDiscordRpcState(state)}
            labelContent={t('settingsPage.enableDiscordRpc')}
          />
        </li>

        {/* ── Last.fm ── */}
        <li className="last-fm-integration mb-4">
          <div className="description">{t('settingsPage.integrateLastFm')}</div>
          <div className="flex p-4 pb-0">
            <img
              src={LastFMIcon}
              alt={t('settingsPage.lastFmLogo')}
              className={`mr-4 h-16 w-16 rounded-md ${!isLastFmConnected && 'brightness-90 grayscale'}`}
            />
            <div className="grow-0">
              <p
                className={`flex items-center font-semibold uppercase ${
                  isLastFmConnected ? 'text-green-500' : 'text-red-500'
                }`}
              >
                {t(isLastFmConnected ? 'settingsPage.lastFmConnected' : 'settingsPage.lastFmNotConnected')}{' '}
                {isLastFmConnected && userSettings?.lastFmSessionName &&
                  `(${t('settingsPage.loggedInAs')} ${userSettings.lastFmSessionName})`}
              </p>
              <ul className="list-inside list-disc text-sm">
                <li>{t('settingsPage.lastFmDescription1')}</li>
                <li>{t('settingsPage.lastFmDescription2')}</li>
                <li>{t('settingsPage.lastFmDescription3')}</li>
                <li>{t('settingsPage.lastFmDescription4')}</li>
              </ul>
              <Button
                label={isLastFmConnected ? t('settingsPage.authenticateAgain') : t('settingsPage.loginInBrowser')}
                iconName="open_in_new"
                className="mt-2"
                clickHandler={() => window.api.settingsHelpers.loginToLastFmInBrowser()}
              />
            </div>
          </div>
          <ul className="marker:bg-background-color-3 dark:marker:bg-background-color-3 mt-4 list-disc pl-8">
            {[
              { id: 'sendSongScrobblingDataToLastFM', key: 'sendSongScrobblingDataToLastFM', desc: 'scrobblingDescription', label: 'enableScrobbling', fn: updateSongScrobblingToLastFMState },
              { id: 'sendSongFavoritesDataToLastFM', key: 'sendSongFavoritesDataToLastFM', desc: 'sendFavoritesToLastFmDescription', label: 'sendFavoritesToLastFm', fn: updateSongFavoritesToLastFMState },
              { id: 'sendNowPlayingSongDataToLastFM', key: 'sendNowPlayingSongDataToLastFM', desc: 'sendNowPlayingToLastFmDescription', label: 'sendNowPlayingToLastFm', fn: updateSendNowPlayingSongDataToLastFMState },
            ].map(({ id, key, desc, label, fn }) => (
              <li key={id} className={`last-fm-integration mb-4 transition-opacity ${!isLastFmConnected && 'cursor-not-allowed opacity-50'}`}>
                <div className="description">{t(`settingsPage.${desc}`)}</div>
                <Checkbox
                  id={id}
                  isChecked={!!(userSettings as any)?.[key]}
                  checkedStateUpdateFunction={(state) => fn(state)}
                  labelContent={t(`settingsPage.${label}`)}
                  isDisabled={!isLastFmConnected}
                />
              </li>
            ))}
          </ul>
        </li>
      </ul>
    </li>
  );
};

export default AccountsSettings;
