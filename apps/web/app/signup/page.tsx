import Link from 'next/link';
import { signUpCompany } from './actions';
import { Button } from '@/components/ui/Button';

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="mx-auto mt-24 max-w-sm rounded-2xl border border-subtle bg-surface p-6 shadow-[0_24px_60px_-18px_rgba(2,6,23,.6)]">
      <h1 className="text-lg font-extrabold">✦ Create your company</h1>
      <p className="mb-4 text-sm text-muted">Set up WorkSight for your team — you'll be the admin.</p>
      <form action={signUpCompany} className="space-y-3">
        <input name="org_name" placeholder="Company name" required className="w-full rounded-lg border border-subtle bg-surface-2 px-3 py-2 text-sm text-fg" />
        <input name="full_name" placeholder="Your name" required className="w-full rounded-lg border border-subtle bg-surface-2 px-3 py-2 text-sm text-fg" />
        <input name="email" type="email" placeholder="Work email" required className="w-full rounded-lg border border-subtle bg-surface-2 px-3 py-2 text-sm text-fg" />
        <input name="password" type="password" placeholder="Choose a password" required minLength={6} className="w-full rounded-lg border border-subtle bg-surface-2 px-3 py-2 text-sm text-fg" />
        <Button className="w-full justify-center" icon="✦">Create company &amp; sign in</Button>
      </form>
      {error && <p className="mt-3 text-sm text-rose-500">{error}</p>}
      <p className="mt-4 text-sm text-muted">Already have an account? <Link href="/login" className="text-accent hover:underline">Sign in</Link></p>
    </div>
  );
}
