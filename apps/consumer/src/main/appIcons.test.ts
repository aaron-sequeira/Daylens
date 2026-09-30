import { describe, expect, it, vi } from 'vitest';
import { createAppIcons } from './appIcons';

describe('createAppIcons', () => {
  it('looks up the stored path once per app and caches the icon', async () => {
    const pathFor = vi.fn((n: string) => (n === 'Code' ? 'C:\\code.exe' : null));
    const iconFor = vi.fn(async (p: string) => `data:image/png;base64,${p.length}`);
    const icon = createAppIcons({ pathFor, iconFor });
    expect(await icon('Code')).toBe('data:image/png;base64,11');
    expect(await icon('Code')).toBe('data:image/png;base64,11');
    expect(pathFor).toHaveBeenCalledTimes(1);
    expect(iconFor).toHaveBeenCalledTimes(1);
  });

  it('returns null when there is no path or the icon lookup fails', async () => {
    const icon = createAppIcons({ pathFor: (n) => (n === 'Broken' ? 'C:\\x.exe' : null), iconFor: async () => { throw new Error('no icon'); } });
    expect(await icon('Unknown')).toBeNull();
    expect(await icon('Broken')).toBeNull();
  });
});
