import { previewInvite } from '@/lib/invites';
import { acceptInvite } from './actions';

export default async function JoinPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params;
  const { error } = await searchParams;
  const invite = await previewInvite(token);

  if (!invite) {
    return <div className="mx-auto mt-24 max-w-sm rounded-xl border bg-white p-6 text-center text-sm text-gray-600">This invite link is no longer valid.</div>;
  }
  const accept = acceptInvite.bind(null, token);
  return (
    <div className="mx-auto mt-24 max-w-sm rounded-xl border bg-white p-6 shadow-sm">
      <h1 className="text-lg font-semibold">Join {invite.orgName}</h1>
      <p className="mb-4 text-sm text-gray-500">You've been invited to <span className="font-medium">{invite.teamName}</span> as <span className="font-medium">{invite.role}</span>.</p>
      <form action={accept} className="space-y-3">
        <input name="full_name" placeholder="Full name" required className="w-full rounded border px-3 py-2 text-sm" />
        <input name="email" type="email" placeholder="Work email" required className="w-full rounded border px-3 py-2 text-sm" />
        <input name="password" type="password" placeholder="Choose a password" required minLength={6} className="w-full rounded border px-3 py-2 text-sm" />
        <button type="submit" className="w-full rounded bg-gray-900 px-3 py-2 text-sm text-white">Create account & join</button>
      </form>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}
