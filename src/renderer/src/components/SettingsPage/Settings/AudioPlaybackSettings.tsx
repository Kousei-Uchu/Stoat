import { store } from '@renderer/store/store';
import { useStore } from '@tanstack/react-store';
import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import i18n from '../../../i18n';
import storage from '../../../utils/localStorage';
import Button from '../../Button';
import Checkbox from '../../Checkbox';
import Dropdown, { type DropdownOption } from '../../Dropdown';

const second = i18n.t('settingsPage.second');
const seconds = i18n.t('settingsPage.second_other');

const seekbarScrollIntervals: DropdownOption<string>[] = [
  { label: `1 ${second}`, value: '1' },
  { label: `2.5 ${seconds}`, value: '2.5' },
  { label: `5 ${seconds}`, value: '5' },
  { label: `10 ${seconds}`, value: '10' },
  { label: `15 ${seconds}`, value: '15' },
  { label: `20 ${seconds}`, value: '20' }
];

const AudioPlaybackSettings = () => {
  const preferences = useStore(store, (state) => state.localStorage.preferences);
  const { t } = useTranslation();

  const [seekbarScrollInterval, setSeekbarScrollInterval] = useState('5');
  const [playbackRateInterval, setPlaybackRateInterval] = useState(1);
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
    const interval = storage.preferences.getPreferences('seekbarScrollInterval');
    const playbackRate = storage.playback.getPlaybackOptions('playbackRate');
    setPlaybackRateInterval(playbackRate);
    setSeekbarScrollInterval(interval.toString());
  }, []);

  const playbackRateSeekBarCssProperties: CSSProperties = {};
  playbackRateSeekBarCssProperties['--seek-before-width'] = `${
    ((playbackRateInterval - 0.25) / (4 - 0.25)) * 100
  }%`;

  return (
    <li
      className="main-container audio-playback-settings-container mb-16"
      id="audio-playback-settings-container"
    >
      <div className="title-container text-font-color-highlight dark:text-dark-font-color-highlight mt-1 mb-4 flex items-center text-2xl font-medium">
        <span className="material-icons-round-outlined mr-2">slow_motion_video</span>
        {t('settingsPage.audioPlayback')}
      </div>
      <ul className="marker:bg-font-color-highlight dark:marker:bg-dark-font-color-highlight list-disc pl-6">
        <li className="secondary-container show-remaining-song-duration mb-4">
          <div className="description">
            {t('settingsPage.showRemainingSongDurationDescription')}
          </div>
          <Checkbox
            id="toggleShowRemainingSongDuration"
            isChecked={preferences?.showSongRemainingTime}
            checkedStateUpdateFunction={(state) =>
              storage.preferences.setPreferences('showSongRemainingTime', state)
            }
            labelContent={t('settingsPage.showRemainingSongDuration')}
          />
        </li>

        <li className="playback-rate mb-6" id="playbackRateInterval">
          <div className="description">{t('settingsPage.changePlaybackRate')}</div>
          <div className="mt-6 flex items-center">
            <div className="flex w-1/2 min-w-[120px] flex-col items-center justify-center">
              <span className="text-font-color-highlight dark:text-dark-font-color-highlight">
                {t('settingsPage.playbackRate')}: {playbackRateInterval} x
              </span>
              <div className="flex w-full items-center pl-2">
                <span className="text-sm">0.25x</span>
                <input
                  type="range"
                  name="seek-bar-slider"
                  id="seek-bar-slider"
                  className="seek-bar-slider thumb-visible before:bg-font-color-highlight hover:before:bg-font-color-highlight dark:before:bg-font-color-highlight dark:hover:before:bg-dark-font-color-highlight relative float-left mx-4 h-6 w-full appearance-none bg-[transparent] p-0 outline-hidden outline-offset-1 before:absolute before:top-1/2 before:left-0 before:h-1 before:w-[var(--seek-before-width)] before:-translate-y-1/2 before:cursor-pointer before:rounded-3xl before:transition-[width,background] before:content-[''] focus-visible:outline!"
                  min={0.25}
                  step={0.05}
                  max={4.0}
                  value={playbackRateInterval || 1}
                  onChange={(e) => {
                    const val = e.currentTarget.valueAsNumber;
                    setPlaybackRateInterval(val);
                    storage.playback.setPlaybackOptions('playbackRate', val);
                  }}
                  style={playbackRateSeekBarCssProperties}
                  title={`${playbackRateInterval}x`}
                />
                <span className="text-sm">4x</span>
              </div>
            </div>
            <Button
              label={t('settingsPage.resetPlaybackRate')}
              iconName="restart_alt"
              className="ml-6"
              isDisabled={playbackRateInterval === 1}
              clickHandler={() => {
                setPlaybackRateInterval(1);
                storage.playback.setPlaybackOptions('playbackRate', 1);
              }}
            />
          </div>
        </li>

        <li className="seekbar-scroll-interval mb-4">
          <div className="description">{t('settingsPage.seekbarScrollInterval')}</div>
          <Dropdown
            className="mt-4"
            name="seekbarScrollInterval"
            value={seekbarScrollInterval?.toString()}
            options={seekbarScrollIntervals}
            onChange={(e) => {
              const val = e.currentTarget.value;
              setSeekbarScrollInterval(val);
              storage.preferences.setPreferences('seekbarScrollInterval', parseFloat(val));
            }}
          />
        </li>

        {/* ── Crossfade ── */}
        <li className="crossfade-settings mb-4">
          <div className="description">
            Enable a smooth fade between tracks so playback never cuts abruptly.
          </div>
          <Checkbox
            id="enableCrossfade"
            isChecked={enableCrossfade}
            checkedStateUpdateFunction={(state) => {
              setEnableCrossfade(state);
              storage.preferences.setPreferences('enableCrossfade', state);
            }}
            labelContent={t('settingsPage.enableCrossfade') || 'Enable crossfade between tracks'}
          />
          {enableCrossfade && (
            <div className="ml-6 mt-2 flex items-center gap-3">
              <label className="w-28 text-xs text-font-color-black/55 dark:text-font-color-white/55">
                Duration
              </label>
              <input
                type="range"
                min={1}
                max={12}
                step={1}
                value={crossfadeDuration}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setCrossfadeDuration(v);
                  storage.preferences.setPreferences('crossfadeDuration', v);
                }}
                className="flex-1 accent-font-color-highlight dark:accent-dark-font-color-highlight"
              />
              <span className="w-10 text-right text-xs tabular-nums text-font-color-black/55 dark:text-font-color-white/55">
                {crossfadeDuration}s
              </span>
            </div>
          )}
        </li>

        {/* ── Loudness normalisation ── */}
        <li className="loudness-normalisation-settings mb-4">
          <div className="description">
            Keep all tracks at a consistent volume level during playback.
          </div>
          <Checkbox
            id="enableLoudnessNormalization"
            isChecked={enableLoudnessNormalization}
            checkedStateUpdateFunction={(state) => {
              setEnableLoudnessNormalization(state);
              storage.preferences.setPreferences('enableLoudnessNormalization', state);
            }}
            labelContent={
              t('settingsPage.enableLoudnessNormalization') || 'Enable loudness normalisation'
            }
          />
        </li>
      </ul>
    </li>
  );
};

export default AudioPlaybackSettings;
