import { previewInvite } from '@/lib/invites';
import { acceptInvite } from './actions';
import { Button } from '@/components/ui/Button';

export default async function JoinPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params;
  const { error } = await searchParams;
  const invite = await previewInvite(token);

  if (!invite) {
    return (
      <div className="mx-auto mt-24 max-w-sm rounded-2xl border border-subtle bg-surface p-6 text-center text-sm text-muted shadow-[0_24px_60px_-18px_rgba(2,6,23,.6)]">
        This invite link is no longer valid.
      </div>
    );
  }
  const accept = acceptInvite.bind(null, token);
  return (
    <div className="mx-auto mt-24 max-w-sm rounded-2xl border border-subtle bg-surface p-6 shadow-[0_24px_60px_-18px_rgba(2,6,23,.6)]">
      <h1 className="text-lg font-semibold text-fg">Join {invite.orgName}</h1>
      <p className="mb-4 text-sm text-muted">You&apos;ve been invited to <span className="font-medium text-fg">{invite.teamName}</span> as <span className="font-medium text-fg">{invite.role}</span>.</p>
      <form action={accept} className="space-y-3">
        <input name="full_name" placeholder="Full name" required className="w-full rounded-lg border border-subtle bg-surface-2 px-3 py-2 text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/40" />
        <input name="email" type="email" placeholder="Work email" required className="w-full rounded-lg border border-subtle bg-surface-2 px-3 py-2 text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/40" />
        <input name="password" type="password" placeholder="Choose a password" required minLength={6} className="w-full rounded-lg border border-subtle bg-surface-2 px-3 py-2 text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/40" />
        <Button className="w-full justify-center" icon="✦">Create account &amp; join</Button>
      </form>
      {error && <p className="mt-3 text-sm text-rose-500">{error}</p>}
    </div>
  );
}
