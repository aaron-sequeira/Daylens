import Link from 'next/link';

export default function JoinDone() {
  return (
    <div className="mx-auto mt-24 max-w-sm rounded-2xl border border-subtle bg-surface p-6 text-center shadow-[0_24px_60px_-18px_rgba(2,6,23,.6)]">
      <h1 className="text-lg font-semibold text-fg">You&apos;re in 🎉</h1>
      <p className="mt-2 text-sm text-muted">Your account is set up. Open the dashboard, or install the WorkSight agent and sign in with the same credentials to start syncing your activity.</p>
      <div className="mt-4 flex justify-center">
        <Link href="/" className="inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition bg-accent text-accent-fg hover:opacity-90 shadow-[0_8px_22px_-8px_var(--accent)]">
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
