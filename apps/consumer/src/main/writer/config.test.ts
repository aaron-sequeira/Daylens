import { describe, it, expect } from 'vitest';
import { WRITER_MODELS, resolveTier, tierFor, writerManifest, writerNeedBytes } from './config';

const GiB = 1024 ** 3;
describe('writer config', () => {
  it('picks 4B at 12 GiB or more, 1.7B below', () => {
    expect(tierFor(16 * GiB)).toBe('4b');
    expect(tierFor(12 * GiB)).toBe('4b');
    expect(tierFor(11.9 * GiB)).toBe('1.7b');
    expect(resolveTier('', 16 * GiB)).toBe('4b');
    expect(resolveTier('1.7b', 16 * GiB)).toBe('1.7b');
    expect(resolveTier('junk', 8 * GiB)).toBe('1.7b');
  });
  it('pins a revision and hash per tier', () => {
    const m = writerManifest('4b');
    expect(m.baseUrl).toBe('https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/a06e946bb6b655725eafa393f4a9745d460374c9');
    expect(m.files).toEqual([{ name: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf', size: 2_497_281_120, sha256: '3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597' }]);
    expect(writerManifest('1.7b').files[0]).toMatchObject({ name: 'Qwen3-1.7B-Q4_K_M.gguf', size: 1_107_409_472 });
    expect(writerNeedBytes('4b')).toBe(WRITER_MODELS['4b'].size + GiB);
  });
});
