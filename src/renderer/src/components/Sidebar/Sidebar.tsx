import { SUPPORTS_PLUGINS } from '../../platform';
import { store } from '@renderer/store/store';
import { linkOptions } from '@tanstack/react-router';
import { useStore } from '@tanstack/react-store';
import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ErrorBoundary from '../ErrorBoundary';
import SideBarItem from './SideBarItem';

const Sidebar = memo(() => {
  const bodyBackgroundImage = useStore(store, (state) => state.bodyBackgroundImage);

  const { t } = useTranslation();

  // Build the base nav items (always present on all platforms)
  const baseItems = useMemo(
    () =>
      linkOptions([
        {
          to: '/main-player/home' as const,
          id: 'Home',
          parentClassName: 'home',
          icon: 'home',
          content: t('sideBar.home'),
          isActive: true
        },
        {
          to: '/main-player/search' as const,
          id: 'Search',
          parentClassName: 'search',
          icon: 'search',
          content: t('sideBar.search'),
          isActive: false
        },
        {
          to: '/main-player/songs' as const,
          id: 'Songs',
          parentClassName: 'songs',
          icon: 'music_note',
          content: t('common.song_other'),
          isActive: false
        },
        {
          to: '/main-player/playlists' as const,
          id: 'Playlists',
          parentClassName: 'playlists',
          icon: 'queue_music',
          content: t('common.playlist_other'),
          isActive: false
        },
        {
          to: '/main-player/folders' as const,
          id: 'Folders',
          parentClassName: 'folders',
          icon: 'folder',
          content: t('common.folder_other'),
          isActive: false
        },
        {
          to: '/main-player/artists' as const,
          id: 'Artists',
          parentClassName: 'artists',
          icon: 'people',
          content: t('common.artist_other'),
          isActive: false
        },
        {
          to: '/main-player/albums' as const,
          id: 'Albums',
          parentClassName: 'albums',
          icon: 'album',
          content: t('common.album_other'),
          isActive: false
        },
        {
          to: '/main-player/genres' as const,
          id: 'Genres',
          parentClassName: 'genres',
          icon: 'track_changes',
          content: t('common.genre_other'),
          isActive: false
        },
        {
          to: '/main-player/settings' as const,
          id: 'Settings',
          parentClassName: 'settings',
          icon: 'settings',
          content: t('settingsPage.settings'),
          isActive: false
        }
      ]),
    [t]
  );

  // Plugin-gated items — only rendered on non-iOS platforms
  const pluginItems = useMemo(
    () =>
      SUPPORTS_PLUGINS
        ? linkOptions([
            {
              to: '/main-player/download' as const,
              id: 'Download',
              parentClassName: 'download',
              icon: 'download',
              content: t('sideBar.download') || 'Download',
              isActive: false
            },
            {
              to: '/main-player/dj' as const,
              id: 'DjMode',
              parentClassName: 'dj',
              icon: 'radio',
              content: t('sideBar.djMode') || 'DJ Mode',
              isActive: false
            },
            {
              to: '/main-player/plugins' as const,
              id: 'Plugins',
              parentClassName: 'plugins',
              icon: 'extension',
              content: t('sideBar.plugins') || 'Plugins',
              isActive: false
            },
          ])
        : [],
    [t]
  );

  // Merge: Search → [plugin items] → Songs → ...
  // Insert plugin items after Search (index 1) and before Songs
  const linkData = useMemo(() => {
    const result = [...baseItems];
    // Insert pluginItems after index 1 (Search)
    result.splice(2, 0, ...pluginItems);
    return result;
  }, [baseItems, pluginItems]);

  const [data, setData] = useState<typeof linkData>();

  useEffect(() => {
    setData(linkData);
  }, [linkData]);

  const sideBarItems = useMemo(
    () =>
      data
        ? data.map((link) => (
            <SideBarItem
              to={link.to}
              key={link.id}
              parentClassName={link.parentClassName}
              icon={link.icon}
              content={link.content}
            />
          ))
        : [],
    [data]
  );

  return (
    <nav
      className={`side-bar relative z-20 order-1 !h-full w-[30%] !max-w-[18rem] grow rounded-tr-2xl transition-[width] ${
        bodyBackgroundImage
          ? 'bg-side-bar-background/50 dark:bg-dark-background-color-2/50 backdrop-blur-md'
          : 'bg-side-bar-background dark:bg-dark-background-color-2'
      } delay-200 md:hover:w-60 lg:absolute lg:w-14 lg:hover:w-[30%] lg:hover:shadow-2xl`}
    >
      <ErrorBoundary>
        <ul className="relative flex h-full! flex-col gap-1 overflow-x-hidden pt-4 pb-2">
          {sideBarItems}
        </ul>
      </ErrorBoundary>
    </nav>
  );
});

Sidebar.displayName = 'Sidebar';
export default Sidebar;
