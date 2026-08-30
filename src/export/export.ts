import type { Graph } from '../compositor/graph.js';
import { renderRegion } from '../compositor/render.js';
import type { Surface } from '../compositor/surface.js';
import type { ResolvedTargetContract } from '../project/types.js';

export type MetadataPolicy = 'discard' | 'preserve' | 'rewrite';

export interface ExportPlan {
  alpha: 'opaque-black' | 'preserve';
  bitDepth: 8 | 16;
  channels: ResolvedTargetContract['channels'];
  colorSpace: ResolvedTargetContract['colorSpace'];
  encoder: 'browser-raster' | 'native-png';
  format: ResolvedTargetContract['outputFormat'];
  height: number;
  metadataPolicy: MetadataPolicy;
  mimeType: string;
  width: number;
}

export interface ExportOptions {
  metadata?: Readonly<Record<string, string>>;
  metadataPolicy?: MetadataPolicy;
  tileWidth?: number;
}

export interface ExportArtifact {
  byteLength: number;
  chunks: readonly Uint8Array[];
  extension: string;
  mimeType: string;
  plan: ExportPlan;
}

export interface BrowserRasterEncoder {
  encode(
    rgba: Uint8Array,
    width: number,
    height: number,
    options: { alpha: ExportPlan['alpha']; colorSpace: ExportPlan['colorSpace']; mimeType: string },
  ): Promise<Uint8Array>;
}

export function buildExportPlan(
  contract: ResolvedTargetContract,
  metadataPolicy: MetadataPolicy = 'discard',
): ExportPlan {
  const mimeType =
    contract.outputFormat === 'png'
      ? 'image/png'
      : contract.outputFormat === 'jpeg'
        ? 'image/jpeg'
        : 'image/webp';
  if (contract.outputFormat !== 'png' && contract.outputBitDepth !== 8) {
    throw new Error(`${contract.outputFormat.toUpperCase()} export supports 8-bit output only`);
  }
  if (contract.outputFormat === 'jpeg' && contract.alphaPolicy !== 'opaque') {
    throw new Error('JPEG export requires opaque alpha policy');
  }
  return {
    alpha: contract.alphaPolicy === 'preserve' ? 'preserve' : 'opaque-black',
    bitDepth: contract.outputBitDepth,
    channels: contract.channels,
    colorSpace: contract.colorSpace,
    encoder: contract.outputFormat === 'png' ? 'native-png' : 'browser-raster',
    format: contract.outputFormat,
    height: contract.height,
    metadataPolicy,
    mimeType,
    width: contract.width,
  };
}

function crcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let entry = 0; entry < table.length; entry += 1) {
    let value = entry;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[entry] = value >>> 0;
  }
  return table;
}

const CRC_TABLE = crcTable();

function uint32(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  let crc = 0xffffffff;
  for (const value of [...typeBytes, ...data]) {
    crc = (CRC_TABLE[(crc ^ value) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  const output = new Uint8Array(12 + data.length);
  output.set(uint32(data.length), 0);
  output.set(typeBytes, 4);
  output.set(data, 8);
  output.set(uint32((crc ^ 0xffffffff) >>> 0), 8 + data.length);
  return output;
}

function colorType(plan: ExportPlan): number {
  if (plan.channels === 'gray') return 0;
  if (plan.channels === 'gray-alpha') return plan.alpha === 'preserve' ? 4 : 0;
  if (plan.channels === 'rgb') return 2;
  return plan.alpha === 'preserve' ? 6 : 2;
}

function channelCount(plan: ExportPlan): number {
  const type = colorType(plan);
  if (type === 0) return 1;
  if (type === 4) return 2;
  if (type === 2) return 3;
  return 4;
}

function linearToSrgb(value: number): number {
  const bounded = Math.max(0, Math.min(1, value));
  return bounded <= 0.0031308 ? bounded * 12.92 : 1.055 * bounded ** (1 / 2.4) - 0.055;
}

function encodedChannels(
  surface: Surface,
  pixelOffset: number,
  plan: ExportPlan,
): readonly number[] {
  const alpha = Math.max(0, Math.min(1, surface.data[pixelOffset + 3] ?? 0));
  const divisor = plan.alpha === 'preserve' && alpha > 0 ? alpha : 1;
  const red = (surface.data[pixelOffset] ?? 0) / divisor;
  const green = (surface.data[pixelOffset + 1] ?? 0) / divisor;
  const blue = (surface.data[pixelOffset + 2] ?? 0) / divisor;
  const gray = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  const type = colorType(plan);
  if (type === 0) return [linearToSrgb(gray)];
  if (type === 4) return [linearToSrgb(gray), alpha];
  if (type === 2) return [linearToSrgb(red), linearToSrgb(green), linearToSrgb(blue)];
  return [linearToSrgb(red), linearToSrgb(green), linearToSrgb(blue), alpha];
}

function encodeRow(graph: Graph, y: number, plan: ExportPlan, tileWidth: number): Uint8Array {
  const bytesPerSample = plan.bitDepth / 8;
  const row = new Uint8Array(1 + plan.width * channelCount(plan) * bytesPerSample);
  let outputOffset = 1;
  for (let x = 0; x < plan.width; x += tileWidth) {
    const width = Math.min(tileWidth, plan.width - x);
    const surface = renderRegion(graph, { h: 1, w: width, x, y }, 1);
    for (let pixel = 0; pixel < width; pixel += 1) {
      for (const value of encodedChannels(surface, pixel * 4, plan)) {
        const encoded = Math.round(
          Math.max(0, Math.min(1, value)) * (plan.bitDepth === 8 ? 255 : 65535),
        );
        if (plan.bitDepth === 16) row[outputOffset++] = encoded >>> 8;
        row[outputOffset++] = encoded & 0xff;
      }
    }
  }
  return row;
}

function storedDeflateBlock(data: Uint8Array, final: boolean): Uint8Array {
  const length = data.length;
  const complement = ~length & 0xffff;
  const output = new Uint8Array(length + 5);
  output[0] = final ? 1 : 0;
  output[1] = length & 0xff;
  output[2] = length >>> 8;
  output[3] = complement & 0xff;
  output[4] = complement >>> 8;
  output.set(data, 5);
  return output;
}

function adlerUpdate(state: { a: number; b: number }, data: Uint8Array): void {
  for (const value of data) {
    state.a = (state.a + value) % 65521;
    state.b = (state.b + state.a) % 65521;
  }
}

function metadataChunks(
  plan: ExportPlan,
  metadata: Readonly<Record<string, string>>,
): Uint8Array[] {
  if (plan.metadataPolicy === 'discard') return [];
  const encoder = new TextEncoder();
  return Object.entries(metadata)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => pngChunk('tEXt', encoder.encode(`${key}\0${value}`)));
}

export function exportTargetPng(
  graph: Graph,
  contract: ResolvedTargetContract,
  options: ExportOptions = {},
): ExportArtifact {
  const plan = buildExportPlan(contract, options.metadataPolicy);
  if (plan.format !== 'png') throw new Error('Native tiled export currently accepts PNG targets');
  const tileWidth = Math.max(1, Math.floor(options.tileWidth ?? 256));
  const chunks: Uint8Array[] = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])];
  const header = new Uint8Array(13);
  header.set(uint32(plan.width), 0);
  header.set(uint32(plan.height), 4);
  header[8] = plan.bitDepth;
  header[9] = colorType(plan);
  chunks.push(pngChunk('IHDR', header));
  chunks.push(
    plan.colorSpace === 'srgb'
      ? pngChunk('sRGB', new Uint8Array([0]))
      : pngChunk('cICP', new Uint8Array([12, 13, 0, 1])),
  );
  chunks.push(...metadataChunks(plan, options.metadata ?? {}));
  chunks.push(pngChunk('IDAT', new Uint8Array([0x78, 0x01])));
  const adler = { a: 1, b: 0 };
  const pending: number[] = [];
  const totalBytes = plan.height * (1 + plan.width * channelCount(plan) * (plan.bitDepth / 8));
  let emittedBytes = 0;
  const emit = (final: boolean): void => {
    const data = new Uint8Array(pending.splice(0, Math.min(65535, pending.length)));
    adlerUpdate(adler, data);
    emittedBytes += data.length;
    chunks.push(pngChunk('IDAT', storedDeflateBlock(data, final)));
  };
  for (let y = 0; y < plan.height; y += 1) {
    for (const value of encodeRow(graph, y, plan, tileWidth)) pending.push(value);
    while (pending.length >= 65535) emit(emittedBytes + 65535 === totalBytes);
  }
  if (pending.length > 0) emit(true);
  chunks.push(pngChunk('IDAT', uint32(((adler.b << 16) | adler.a) >>> 0)));
  chunks.push(pngChunk('IEND', new Uint8Array()));
  return {
    byteLength: chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
    chunks,
    extension: 'png',
    mimeType: plan.mimeType,
    plan,
  };
}

export function artifactBytes(artifact: ExportArtifact): Uint8Array {
  const output = new Uint8Array(artifact.byteLength);
  let offset = 0;
  for (const chunk of artifact.chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export async function exportTargetWithBrowserEncoder(
  graph: Graph,
  contract: ResolvedTargetContract,
  encoder: BrowserRasterEncoder,
  options: ExportOptions & { maximumPixels?: number } = {},
): Promise<ExportArtifact> {
  const plan = buildExportPlan(contract, options.metadataPolicy);
  if (plan.encoder !== 'browser-raster') {
    throw new Error('Use native tiled PNG export for PNG targets');
  }
  const maximumPixels = options.maximumPixels ?? 16_777_216;
  if (plan.width * plan.height > maximumPixels) {
    throw new Error('This browser encoder cannot stream the target; use PNG or a smaller target');
  }
  const rgbaPlan = { ...plan, alpha: plan.alpha, bitDepth: 8 as const, channels: 'rgba' as const };
  const rgba = new Uint8Array(plan.width * plan.height * 4);
  for (let y = 0; y < plan.height; y += 1) {
    const row = encodeRow(graph, y, rgbaPlan, Math.max(1, options.tileWidth ?? 256));
    rgba.set(row.subarray(1), y * plan.width * 4);
  }
  const bytes = await encoder.encode(rgba, plan.width, plan.height, {
    alpha: plan.alpha,
    colorSpace: plan.colorSpace,
    mimeType: plan.mimeType,
  });
  return {
    byteLength: bytes.byteLength,
    chunks: [bytes],
    extension: plan.format === 'jpeg' ? 'jpg' : 'webp',
    mimeType: plan.mimeType,
    plan,
  };
}
