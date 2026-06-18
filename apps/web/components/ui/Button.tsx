import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const styles: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:opacity-90 shadow-[0_8px_22px_-8px_var(--accent)]',
  secondary: 'bg-surface-2 text-fg border border-subtle hover:opacity-80',
  ghost: 'text-muted hover:text-fg',
  danger: 'bg-rose-500/10 text-rose-500 border border-rose-500/30 hover:bg-rose-500/20'
};

export function Button(
  { variant = 'primary', size = 'md', icon, children, className = '', ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; icon?: ReactNode }
) {
  const pad = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm';
  return (
    <button {...props} type={props.type ?? 'submit'}
      className={`inline-flex items-center gap-2 rounded-lg font-semibold transition ${pad} ${styles[variant]} ${className}`}>
      {icon && <span aria-hidden>{icon}</span>}{children}
    </button>
  );
}
