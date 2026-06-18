'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
export function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <input readOnly value={value} className="w-80 rounded-lg border border-subtle bg-surface-2 px-2 py-1 text-xs text-fg" />
      <Button type="button" variant="secondary" size="sm" onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? 'Copied' : 'Copy'}</Button>
    </div>
  );
}
