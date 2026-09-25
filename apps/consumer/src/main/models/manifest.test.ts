import { describe, it, expect } from 'vitest';
import { LAYA_REVISION, LAYA_MANIFEST, LAYA_REPO } from './manifest';

describe('Laya model manifest', () => {
  it('LAYA_REVISION should be a 40-character hexadecimal commit id', () => {
    expect(LAYA_REVISION).toMatch(/^[0-9a-f]{40}$/);
  });

  it('every LAYA_MANIFEST file URL should start with the pinned commit URL', () => {
    const expectedPrefix = `https://huggingface.co/${LAYA_REPO}/resolve/${LAYA_REVISION}/`;

    for (const file of LAYA_MANIFEST.files) {
      const fileUrl = `${LAYA_MANIFEST.baseUrl}/${file.name}`;
      expect(fileUrl).toMatch(new RegExp(`^${expectedPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${file.name}$`));
    }
  });

  it('LAYA_MANIFEST baseUrl should include the pinned LAYA_REVISION', () => {
    expect(LAYA_MANIFEST.baseUrl).toContain(LAYA_REVISION);
  });
});
