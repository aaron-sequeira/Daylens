import { getViewerProfile } from '@/lib/queries';

export default async function OverviewPlaceholder() {
  const viewer = await getViewerProfile();
  return (
    <div className="text-sm text-gray-600">
      Signed in as {viewer?.full_name}. Team overview lands in the next task.
    </div>
  );
}
