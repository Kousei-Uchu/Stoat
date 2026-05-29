import { createFileRoute } from '@tanstack/react-router';
import PluginsPage from '@renderer/components/PluginsPage/PluginsPage';

export const Route = createFileRoute('/main-player/plugins/')({
  component: PluginsPage,
});
