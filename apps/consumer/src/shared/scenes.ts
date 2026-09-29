import type { Animation } from './reminders';

const svg = (body: string): string => `<svg class="dl-scene-svg" viewBox="0 0 120 120" aria-hidden="true">${body}</svg>`;
const STEAM = (xs: number[], y: number) => xs.map((x, i) => `<path class="sc-ink sc-steam sc-s${i + 1}" d="M${x},${y} q-5,-6 0,-12 t0,-12"/>`).join('');
const BOTTLE = 'M51,24 h18 q0,5 7,9 q9,6 9,17 v48 q0,9 -9,9 h-32 q-9,0 -9,-9 v-48 q0,-11 9,-17 q7,-4 7,-9 z';
const EYE = 'M14,70 q36,-34 72,0 q-36,34 -72,0 z';
const PALM = 'M20,92 q0,-10 12,-10 h26 q10,0 10,8 q0,10 -12,12 h-24 q-12,0 -12,-10 z';
const PHONE = 'M40,40 q-6,4 -4,14 q6,26 30,32 q10,2 14,-4 l-10,-10 q-4,2 -8,0 q-10,-6 -14,-16 q-1,-4 1,-8 z';

export const SCENES: Record<Animation, string> = {
  water: svg(`<defs><clipPath id="sc-bottle"><path d="${BOTTLE}"/></clipPath></defs>
    <g clip-path="url(#sc-bottle)"><g class="sc-fill"><rect x="20" y="52" width="90" height="70" fill="#CFE6FB"/>
    <path class="sc-wave" d="M20,52 q6,-4 12,0 t12,0 t12,0 t12,0 t12,0 t12,0 t12,0" fill="#CFE6FB" stroke="#8EC3EE" stroke-width="2"/>
    <circle class="sc-bub" cx="52" cy="98" r="2.6" fill="#fff"/><circle class="sc-bub" cx="64" cy="102" r="2" fill="#fff"/><circle class="sc-bub" cx="58" cy="100" r="3" fill="#fff"/></g></g>
    <path class="sc-ink" d="${BOTTLE}"/><rect x="49" y="13" width="22" height="10" rx="3" fill="#171717"/>
    <path class="sc-ink" d="M44,62 q-2,10 0,22" stroke="#fff" stroke-width="3" opacity=".8"/>`),
  meal: svg(`${STEAM([44, 60, 76], 48)}
    <path d="M16,62 h88 q-4,36 -44,36 q-40,0 -44,-36 z" fill="#F9DDB9"/>
    <path class="sc-ink" d="M30,62 q5,-7 10,0 t10,0 t10,0 t10,0 t10,0 t10,0" stroke="#E0A458"/>
    <path class="sc-ink" d="M16,62 h88 q-4,36 -44,36 q-40,0 -44,-36 z"/><path class="sc-ink" d="M42,98 h36"/>
    <g class="sc-chop"><path class="sc-ink" d="M84,26 L54,60" stroke-width="4"/><path class="sc-ink" d="M92,30 L60,62" stroke-width="4"/></g>`),
  tea: svg(`${STEAM([46, 58], 42)}
    <ellipse cx="56" cy="98" rx="40" ry="6" fill="#E9E3DD"/><path class="sc-ink" d="M18,98 q38,10 76,0"/>
    <path d="M28,52 h56 v16 q0,24 -28,24 q-28,0 -28,-24 z" fill="#BFEBD3"/><path class="sc-ink" d="M28,52 h56 v16 q0,24 -28,24 q-28,0 -28,-24 z"/>
    <path class="sc-ink" d="M84,58 q14,0 14,11 q0,11 -14,11"/>
    <g class="sc-bag"><path class="sc-ink" d="M62,50 L70,26" stroke-width="2"/><rect x="65" y="16" width="12" height="11" rx="2" fill="#F4C6C8" stroke="#171717" stroke-width="2.4"/></g>`),
  dinner: svg(`${STEAM([52, 66], 52)}
    <ellipse cx="60" cy="78" rx="40" ry="14" fill="#E9E3DD"/><ellipse class="sc-ink" cx="60" cy="78" rx="40" ry="14"/>
    <ellipse cx="60" cy="76" rx="22" ry="7" fill="#F4C6C8"/><path class="sc-ink" d="M50,74 q10,-6 20,0" stroke="#D98C90"/>
    <g class="sc-fork"><path class="sc-ink" d="M10,58 v34"/><path class="sc-ink" d="M5,58 v10 q5,7 10,0 v-10"/></g>
    <g class="sc-knife"><path class="sc-ink" d="M110,58 v34"/><path d="M110,58 q-8,7 0,18 z" fill="#171717"/></g>`),
  stretch: svg(`<path class="sc-ink" d="M30,102 h60" stroke="#BFEBD3" stroke-width="5"/>
    <g class="sc-body"><circle class="sc-ink" cx="60" cy="30" r="8" fill="#F9DDB9"/><path class="sc-ink" d="M60,38 v34"/>
    <g class="sc-arm-l"><path class="sc-ink" d="M60,46 l-20,-14"/></g><g class="sc-arm-r"><path class="sc-ink" d="M60,46 l20,-14"/></g></g>
    <path class="sc-ink" d="M60,72 l-12,28 M60,72 l12,28"/>`),
  walk: svg(`<g class="sc-ground"><path class="sc-ink" d="M0,98 q10,-4 20,0 t20,0 t20,0 t20,0 t20,0 t20,0 t20,0 t20,0" stroke="#D8D2FC" stroke-width="4"/></g>
    <g class="sc-walker"><circle class="sc-ink" cx="60" cy="28" r="8" fill="#BFEBD3"/><path class="sc-ink" d="M60,36 l-2,30"/>
    <g class="sc-leg-a"><path class="sc-ink" d="M58,66 l-8,26"/></g><g class="sc-leg-b"><path class="sc-ink" d="M58,66 l8,26"/></g>
    <g class="sc-arm-a"><path class="sc-ink" d="M59,44 l-10,16"/></g><g class="sc-arm-b"><path class="sc-ink" d="M59,44 l10,16"/></g></g>`),
  eyes: svg(`<defs><clipPath id="sc-eye"><path d="${EYE}"/></clipPath></defs>
    <circle cx="98" cy="30" r="9" fill="#F6B35E"/><path class="sc-ink" d="M84,40 h28" stroke="#C9BFB6"/>
    <path d="${EYE}" fill="#fff"/>
    <g clip-path="url(#sc-eye)"><g class="sc-iris"><circle cx="50" cy="70" r="12" fill="#CFE6FB"/><circle cx="50" cy="70" r="5.5" fill="#171717"/></g>
    <rect class="sc-lid" x="10" y="34" width="80" height="38" fill="#F2EBE6"/></g>
    <path class="sc-ink" d="${EYE}"/>`),
  medicine: svg(`<path d="M88,60 h20 l-3,40 h-14 z" fill="#CFE6FB"/><path class="sc-ink" d="M88,52 h20 l-3,48 h-14 z"/>
    <path d="${PALM}" fill="#F9DDB9"/><path class="sc-ink" d="${PALM}"/>
    <g class="sc-pill"><rect x="36" y="30" width="24" height="11" rx="5.5" fill="#fff"/><path d="M48,30 h6.5 a5.5,5.5 0 0 1 0,11 h-6.5 z" fill="#F4C6C8"/>
    <rect class="sc-ink" x="36" y="30" width="24" height="11" rx="5.5"/></g>`),
  call: svg(`<g class="sc-phone"><path d="${PHONE}" fill="#D8D2FC"/><path class="sc-ink" d="${PHONE}"/></g>
    <path class="sc-ink sc-ring" d="M74,38 q8,8 8,18"/><path class="sc-ink sc-ring sc-r2" d="M80,28 q14,12 14,30"/>`),
  breathe: svg(`<circle class="sc-breathe" cx="60" cy="60" r="38" fill="#BFEBD3"/>
    <circle class="sc-ink" cx="60" cy="60" r="38" stroke="#9ADBB9" opacity=".6"/>`)
};
