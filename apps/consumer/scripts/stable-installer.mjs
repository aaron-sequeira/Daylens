// The website's download buttons point at releases/latest/download/Daylens-Setup.exe, so each release also
// carries an unversioned copy of the installer. This makes that copy next to the versioned one.
import { copyFileSync, readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
copyFileSync(new URL(`../release/Daylens-Setup-${version}.exe`, import.meta.url), new URL('../release/Daylens-Setup.exe', import.meta.url));
console.log(`[stable-installer] release/Daylens-Setup.exe ← Daylens-Setup-${version}.exe`);
