'use client';
import { useState } from 'react';
export function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <input readOnly value={value} className="w-80 rounded border px-2 py-1 text-xs" />
      <button onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="rounded border px-2 py-1 text-xs text-gray-600">{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}
