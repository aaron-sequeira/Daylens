import type { Manifest } from './downloader';

export const LAYA_REPO = 'aaronalexS/daylens-laya-onnx';
// Pinned upload (a commit id) so a later push to the repo can't swap the model under users. Set in Task 11.
export const LAYA_REVISION = 'main';

export const LAYA_MANIFEST: Manifest = {
  baseUrl: `https://huggingface.co/${LAYA_REPO}/resolve/${LAYA_REVISION}`,
  files: [
    { name: 'laya.onnx', size: 1_686_012_251, sha256: 'bbd684549c90cab727e43fd1d6c9458cf6e791a6af5913110746c98ba4253ad8' },
    { name: 'tokenizer.json', size: 3_583_228, sha256: '6c8aaa9a542084f2457eab775d4eeb51f92a70c0fd9de28d5edb0ddec3c08d30' },
    { name: 'tokenizer_config.json', size: 337, sha256: '08d4cf3ac4dca381759441b85b91a6d40e688471dcd33d15d6649eb0a9a854d1' },
    { name: 'laya-meta.json', size: 519, sha256: '429b6917f0f855257f18500f163b6a01860fa6d53a0747f4e0f4ebad103a34e9' }
  ]
};
