import { createFileRoute } from '@tanstack/react-router';
import { isPluginEnabled } from '@renderer/plugins/registry';
import DjModePage from '@renderer/components/DjMode/DjModePage';

export const Route = createFileRoute('/main-player/dj/')({
  component: RouteComponent,
  beforeLoad: () => {
    if (!isPluginEnabled('dev.nora.dj')) {
      throw Route.redirect({ to: '/main-player/home' });
    }
  }
});

function RouteComponent() {
  return <DjModePage />;
}
