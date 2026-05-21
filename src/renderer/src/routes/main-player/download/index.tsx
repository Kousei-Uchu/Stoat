import { createFileRoute } from '@tanstack/react-router';
import DownloadPage from '@renderer/components/Download/DownloadPage';

export const Route = createFileRoute('/main-player/download/')({
  component: RouteComponent,
  loader: async () => {
    // placeholder loader in case we add queries later
    await Promise.resolve();
  }
});

function RouteComponent() {
  return <DownloadPage />;
}
