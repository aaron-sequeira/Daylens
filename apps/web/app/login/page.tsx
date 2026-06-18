import Link from 'next/link';
import { login } from './actions';
import { Button } from '@/components/ui/Button';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="mx-auto mt-24 max-w-sm rounded-2xl border border-subtle bg-surface p-6 shadow-[0_24px_60px_-18px_rgba(2,6,23,.6)]">
      <h1 className="text-lg font-extrabold">WorkSight AI</h1>
      <p className="mb-4 text-sm text-muted">Sign in to your dashboard</p>
      <form action={login} className="space-y-3">
        <input name="email" type="email" placeholder="you@acme.test" required className="w-full rounded-lg border border-subtle bg-surface-2 px-3 py-2 text-sm text-fg" />
        <input name="password" type="password" placeholder="Password" required className="w-full rounded-lg border border-subtle bg-surface-2 px-3 py-2 text-sm text-fg" />
        <Button className="w-full justify-center">Sign in</Button>
      </form>
      {error && <p className="mt-3 text-sm text-rose-500">{error}</p>}
      <p className="mt-4 text-sm text-muted">New here? <Link href="/signup" className="text-accent hover:underline">Create a company →</Link></p>
    </div>
  );
}
