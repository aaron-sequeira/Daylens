import Link from 'next/link';
import { Button } from '@/components/ui/Button';

export default function JoinDone() {
  return (
    <div className="mx-auto mt-24 max-w-sm rounded-2xl border border-subtle bg-surface p-6 text-center shadow-[0_24px_60px_-18px_rgba(2,6,23,.6)]">
      <h1 className="text-lg font-semibold text-fg">You&apos;re in 🎉</h1>
      <p className="mt-2 text-sm text-muted">Your account is set up. Open the dashboard, or install the WorkSight agent and sign in with the same credentials to start syncing your activity.</p>
      <div className="mt-4 flex justify-center">
        <Button type="button">
          <Link href="/">Go to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
