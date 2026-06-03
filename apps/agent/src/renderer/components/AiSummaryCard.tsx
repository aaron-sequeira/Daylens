import { useState } from 'react';
import { api } from '../lib/ipc';

export function AiSummaryCard({ date }: { date: string }) {
  const [text, setText] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function generate() {
    setLoading(true); setNote(null);
    const r = await api.summary.generateAi(date);
    setLoading(false);
    if ('text' in r) { setText(r.text); }
    else { setText(null); setNote(r.error === 'no_key' ? 'AI summary is off. Enable it and add an Anthropic API key in Settings.' : 'Could not generate the summary. Try again.'); }
  }

  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">AI summary</div>
        <button onClick={generate} disabled={loading} className="rounded-lg bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50">
          {loading ? 'Generating…' : 'Generate'}
        </button>
      </div>
      {text && <p className="mt-3 text-sm leading-relaxed text-gray-800">{text}</p>}
      {note && <p className="mt-3 text-sm text-amber-700">{note}</p>}
      {!text && !note && <p className="mt-3 text-sm text-gray-500">Click Generate for a natural-language recap of this day.</p>}
    </div>
  );
}
