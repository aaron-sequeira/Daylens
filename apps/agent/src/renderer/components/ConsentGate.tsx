export function ConsentGate({ onAccept }: { onAccept: () => void }) {
  return (
    <div className="mx-auto max-w-xl p-10">
      <h1 className="text-2xl font-semibold">WorkSight Agent</h1>
      <p className="mt-4 text-sm text-gray-600">This app tracks, locally on this device only:</p>
      <ul className="mt-3 list-disc pl-6 text-sm text-gray-700 space-y-1">
        <li>Which application is in the foreground and for how long</li>
        <li>When apps are opened and closed</li>
        <li>Mouse and keyboard <strong>activity counts</strong> (never what you type — no keylogging, no passwords)</li>
        <li>Active vs idle time</li>
      </ul>
      <p className="mt-3 text-sm text-gray-600">Nothing leaves your machine. You can pause from the tray or clear all data anytime.</p>
      <button onClick={onAccept} className="mt-6 rounded-lg bg-black px-4 py-2 text-white">Start tracking</button>
    </div>
  );
}
