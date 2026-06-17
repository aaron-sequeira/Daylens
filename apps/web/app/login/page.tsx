import { login } from './actions';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="mx-auto mt-24 max-w-sm rounded-xl border bg-white p-6 shadow-sm">
      <h1 className="text-lg font-semibold">WorkSight AI</h1>
      <p className="mb-4 text-sm text-gray-500">Sign in to your dashboard</p>
      <form action={login} className="space-y-3">
        <input name="email" type="email" placeholder="you@acme.test" required className="w-full rounded border px-3 py-2 text-sm" />
        <input name="password" type="password" placeholder="Password" required className="w-full rounded border px-3 py-2 text-sm" />
        <button className="w-full rounded bg-gray-900 px-3 py-2 text-sm text-white">Sign in</button>
      </form>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  );
}
