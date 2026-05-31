import { createFileRoute } from '@tanstack/react-router';
import { isPluginEnabled } from '@renderer/plugins/registry';
import DownloadPage from '@renderer/components/Download/DownloadPage';

export const Route = createFileRoute('/main-player/download/')({
  component: RouteComponent,
  loader: async () => {
    // placeholder loader in case we add queries later
    await Promise.resolve();
  },
  beforeLoad: () => {
    if (!isPluginEnabled('dev.nora.downloader')) {
      throw Route.redirect({ to: '/main-player/home' });
    }
  }
});

function RouteComponent() {
  return <DownloadPage />;
}
