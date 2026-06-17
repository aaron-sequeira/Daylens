import Link from 'next/link';
export default function JoinDone() {
  return (
    <div className="mx-auto mt-24 max-w-sm rounded-xl border bg-white p-6 text-center">
      <h1 className="text-lg font-semibold">You're in 🎉</h1>
      <p className="mt-2 text-sm text-gray-600">Your account is set up. Open the dashboard, or install the WorkSight agent and sign in with the same credentials to start syncing your activity.</p>
      <Link href="/" className="mt-4 inline-block rounded bg-gray-900 px-3 py-2 text-sm text-white">Go to dashboard</Link>
    </div>
  );
}
