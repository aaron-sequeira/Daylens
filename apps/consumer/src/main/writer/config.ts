import type { Manifest } from '../models/downloader';

const GiB = 1024 ** 3;
export type WriterTier = '4b' | '1.7b';
export interface WriterModel { tier: WriterTier; repo: string; revision: string; file: string; size: number; sha256: string; label: string; }

// Pinned commits so a later push to the repo can't swap the model under users.
export const WRITER_MODELS: Record<WriterTier, WriterModel> = {
  '4b': { tier: '4b', repo: 'unsloth/Qwen3-4B-Instruct-2507-GGUF', revision: 'a06e946bb6b655725eafa393f4a9745d460374c9',
    file: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf', size: 2_497_281_120, sha256: '3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597', label: 'Qwen3 4B' },
  '1.7b': { tier: '1.7b', repo: 'unsloth/Qwen3-1.7B-GGUF', revision: 'd7f544eead698dbd1f15126ef60b45a1e1933222',
    file: 'Qwen3-1.7B-Q4_K_M.gguf', size: 1_107_409_472, sha256: 'b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897', label: 'Qwen3 1.7B' }
};
export const WRITER_ATTRIBUTION = 'Qwen3 by Alibaba Cloud (Apache-2.0), GGUF by Unsloth.';

export const tierFor = (totalRam: number): WriterTier => (totalRam >= 12 * GiB ? '4b' : '1.7b');
export const resolveTier = (setting: string, totalRam: number): WriterTier =>
  setting === '4b' || setting === '1.7b' ? setting : tierFor(totalRam);
export function writerManifest(tier: WriterTier): Manifest {
  const m = WRITER_MODELS[tier];
  return { baseUrl: `https://huggingface.co/${m.repo}/resolve/${m.revision}`, files: [{ name: m.file, size: m.size, sha256: m.sha256 }] };
}
export const writerNeedBytes = (tier: WriterTier): number => WRITER_MODELS[tier].size + GiB;
