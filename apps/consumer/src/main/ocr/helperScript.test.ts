import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ps1 = readFileSync(join(__dirname, '../../../resources/ocr-helper.ps1'), 'utf8');

describe('ocr-helper.ps1', () => {
  it('skips a hung (not responding) window before PrintWindow, as a normal no-capture result', () => {
    expect(ps1).toContain('public static extern bool IsHungAppWindow(IntPtr h);');
    const fn = ps1.slice(ps1.indexOf('function Capture-Foreground'));
    const hung = fn.indexOf('IsHungAppWindow($h)'), print = fn.indexOf('::PrintWindow(');
    expect(hung).toBeGreaterThan(-1);
    expect(hung).toBeLessThan(print);
    expect(fn.slice(hung, hung + 80)).toContain('return $null');
  });
});
