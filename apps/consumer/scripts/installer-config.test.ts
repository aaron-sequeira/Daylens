import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const app = join(__dirname, '..');
const yml = readFileSync(join(app, 'electron-builder.yml'), 'utf8');
const nsh = readFileSync(join(app, 'resources', 'installer.nsh'), 'utf8');

describe('electron-builder.yml', () => {
  it('identity and one-click per-user install', () => {
    expect(yml).toMatch(/^appId: ai\.worksight\.daylens$/m);
    expect(yml).toMatch(/^productName: Daylens$/m);
    expect(yml).toMatch(/oneClick: true/);
    expect(yml).toMatch(/perMachine: false/);
    expect(yml).toMatch(/include: resources\/installer\.nsh/);
    expect(yml).toMatch(/icon: resources\/icon\.ico/);
  });
  it('excludes CUDA, ARM, Mac and Linux binaries', () => {
    for (const p of ['@node-llama-cpp/win-x64-cuda', '@node-llama-cpp/win-x64-cuda-ext', '@node-llama-cpp/win-arm64',
      '@node-llama-cpp/{linux,mac}-*', 'onnxruntime-node/bin/napi-v3/{darwin,linux}', 'onnxruntime-node/bin/napi-v3/win32/arm64',
      'active-win/lib/binding/*darwin*']) expect(yml).toContain(`!**/node_modules/${p}`);
  });
  it('ships the OCR helper and both tray icons as extra resources', () => {
    for (const f of ['ocr-helper.ps1', 'tray.png', 'tray@2x.png']) expect(yml).toContain(`from: resources/${f}`);
  });
});

describe('installer.nsh', () => {
  it('asks before deleting data, default No, never during an update, with the path quoted', () => {
    expect(nsh).toContain('!macro customUnInstall');
    expect(nsh).toContain('${ifNot} ${isUpdated}');
    expect(nsh).toContain('MB_DEFBUTTON2');
    expect(nsh).toContain('RMDir /r "$APPDATA\\Daylens"');
  });
});
