'use client';
import { useEffect, useState } from 'react';

export function ThemeToggle({ className = '' }: { className?: string }) {
  const [dark, setDark] = useState(true);
  useEffect(() => { setDark(document.documentElement.classList.contains('dark')); }, []);
  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    document.cookie = `ws-theme=${next ? 'dark' : 'light'};path=/;max-age=31536000`;
    try { localStorage.setItem('ws-theme', next ? 'dark' : 'light'); } catch { /* ignore */ }
  }
  return (
    <button onClick={toggle} aria-label="Toggle theme"
      className={`grid h-9 w-9 place-items-center rounded-lg border border-subtle bg-surface-2 text-accent hover:opacity-80 ${className}`}>
      {dark ? '☀' : '☾'}
    </button>
  );
}
