import type {
  AssetAvailability,
  AssetResolverState,
  EmbeddedImageAsset,
  ImageAsset,
  LinkedImageAsset,
  ProjectColorSpace,
} from './types.js';

interface ImageAssetInput {
  colorSpace?: ProjectColorSpace;
  contentHash: string;
  height: number;
  id: string;
  mediaType: string;
  name: string;
  width: number;
}

export function createEmbeddedImageAsset(
  input: ImageAssetInput & { bytesBase64: string },
): EmbeddedImageAsset {
  return {
    bytesBase64: input.bytesBase64,
    colorSpace: input.colorSpace ?? 'srgb',
    contentHash: input.contentHash,
    height: input.height,
    id: input.id,
    kind: 'image',
    mediaType: input.mediaType,
    name: input.name,
    storage: 'embedded',
    width: input.width,
  };
}

export function createLinkedImageAsset(
  input: ImageAssetInput & { fileName: string; lastModified: number },
): LinkedImageAsset {
  return {
    colorSpace: input.colorSpace ?? 'srgb',
    contentHash: input.contentHash,
    fileName: input.fileName,
    height: input.height,
    id: input.id,
    kind: 'image',
    lastModified: input.lastModified,
    mediaType: input.mediaType,
    name: input.name,
    storage: 'linked',
    width: input.width,
  };
}

export function assetAvailability(
  asset: ImageAsset,
  resolver: AssetResolverState,
): AssetAvailability {
  if (asset.storage === 'embedded') return 'embedded';
  return resolver.availableContentHashes.has(asset.contentHash) ? 'available' : 'missing';
}
