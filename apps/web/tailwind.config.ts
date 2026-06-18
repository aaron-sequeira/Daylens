import type { Config } from 'tailwindcss';
export default {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)', surface: 'var(--surface)', 'surface-2': 'var(--surface-2)',
        fg: 'var(--fg)', muted: 'var(--muted)', subtle: 'var(--subtle)',
        accent: 'var(--accent)', 'accent-strong': 'var(--accent-strong)', 'accent-fg': 'var(--accent-fg)'
      },
      borderRadius: { xl2: '1rem' }
    }
  },
  plugins: []
} satisfies Config;
