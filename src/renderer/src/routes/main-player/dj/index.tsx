import { createFileRoute } from '@tanstack/react-router';
import DjModePage from '@renderer/components/DjMode/DjModePage';

export const Route = createFileRoute('/main-player/dj/')({
  component: RouteComponent,
});

function RouteComponent() {
  return <DjModePage />;
}
