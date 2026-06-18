const grads = ['from-emerald-400 to-emerald-600', 'from-sky-400 to-blue-600', 'from-fuchsia-400 to-pink-600', 'from-amber-400 to-orange-600', 'from-cyan-400 to-blue-600'];
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?'; }
export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const g = grads[h % grads.length];
  return (
    <span className={`grid place-items-center rounded-full bg-gradient-to-br ${g} font-bold text-white`}
      style={{ width: size, height: size, fontSize: size * 0.38 }}>{initials(name)}</span>
  );
}
