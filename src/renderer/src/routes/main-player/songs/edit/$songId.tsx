import { createFileRoute } from '@tanstack/react-router';
import SongTagsEditingPage from '@renderer/components/SongTagsEditingPage/SongTagsEditingPage';

export const Route = createFileRoute('/main-player/songs/edit/$songId')({
  component: SongTagsEditingPage,
});
