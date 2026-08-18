import type { DecodedImageAsset } from '../compositor/adapter.js';
import {
  createImportedProject,
  createLinkedImageAsset,
  createOpaqueId,
  type ImageAsset,
  type PixelfProject,
} from '../project/index.js';

export interface DecodedProjectImage {
  asset: ImageAsset;
  decoded: DecodedImageAsset;
  project: PixelfProject;
}

export function srgbChannelToLinear(channel: number): number {
  const value = Math.max(0, Math.min(1, channel));
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${[...new Uint8Array(digest)]
    .map(value => value.toString(16).padStart(2, '0'))
    .join('')}`;
}

export async function decodeImageFile(file: File): Promise<DecodedProjectImage> {
  const [bitmap, bytes] = await Promise.all([createImageBitmap(file), file.arrayBuffer()]);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
    if (context === null) throw new Error('The browser could not decode image pixels');
    context.drawImage(bitmap, 0, 0);
    const encoded = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const linear = new Float32Array(encoded.length);
    for (let offset = 0; offset < encoded.length; offset += 4) {
      linear[offset] = srgbChannelToLinear((encoded[offset] ?? 0) / 255);
      linear[offset + 1] = srgbChannelToLinear((encoded[offset + 1] ?? 0) / 255);
      linear[offset + 2] = srgbChannelToLinear((encoded[offset + 2] ?? 0) / 255);
      linear[offset + 3] = (encoded[offset + 3] ?? 0) / 255;
    }
    const asset = createLinkedImageAsset({
      contentHash: await sha256(bytes),
      fileName: file.name,
      height: bitmap.height,
      id: createOpaqueId('asset'),
      lastModified: file.lastModified,
      mediaType: file.type || 'image/png',
      name: file.name,
      width: bitmap.width,
    });
    const project = createImportedProject(asset);
    return {
      asset,
      decoded: {
        data: linear,
        height: bitmap.height,
        revision: asset.contentHash,
        width: bitmap.width,
      },
      project,
    };
  } finally {
    bitmap.close();
  }
}
