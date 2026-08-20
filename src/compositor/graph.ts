import type { BlendMode } from '../image/blend-modes.js';

export interface SolidSource {
  a: number;
  b: number;
  g: number;
  kind: 'solid';
  r: number;
}

export interface ImageSource {
  data: Float32Array;
  height: number;
  kind: 'image';
  revision: string;
  width: number;
}

export interface CheckerSource {
  first: number;
  kind: 'checker';
  offsetX: number;
  offsetY: number;
  second: number;
  size: number;
}

export type Source = CheckerSource | ImageSource | SolidSource;
export type { BlendMode } from '../image/blend-modes.js';

export interface EffectBase {
  mask?: EntityMask;
}

export interface BlurEffect extends EffectBase {
  kind: 'blur';
  sigma: number;
}

export interface LevelsEffect extends EffectBase {
  gamma: number;
  inBlack: number;
  inWhite: number;
  kind: 'levels';
  outBlack: number;
  outWhite: number;
}

export interface ExposureEffect extends EffectBase {
  kind: 'exposure';
  stops: number;
}

export interface WhiteBalanceEffect extends EffectBase {
  kind: 'white-balance';
  temperature: number;
  tint: number;
}

export interface ContrastEffect extends EffectBase {
  amount: number;
  kind: 'contrast';
}

export interface SaturationEffect extends EffectBase {
  amount: number;
  kind: 'saturation';
}

export interface BrightnessEffect extends EffectBase {
  amount: number;
  kind: 'brightness';
}

export interface TonalRangeEffect extends EffectBase {
  amount: number;
  kind: 'blacks' | 'highlights' | 'shadows' | 'whites';
}

export interface VibranceEffect extends EffectBase {
  amount: number;
  kind: 'vibrance';
}

export interface ClarityEffect extends EffectBase {
  amount: number;
  kind: 'clarity';
  radius: number;
}

export interface NoiseReductionEffect extends EffectBase {
  amount: number;
  kind: 'noise-reduction';
  radius: number;
}

export interface VignetteEffect extends EffectBase {
  amount: number;
  height: number;
  kind: 'vignette';
  width: number;
}

export interface GrainEffect extends EffectBase {
  amount: number;
  kind: 'grain';
  seed: number;
}

export interface OpacityEffect extends EffectBase {
  amount: number;
  kind: 'opacity';
}

export interface ChannelEffect extends EffectBase {
  channel: 'alpha' | 'blue' | 'green' | 'luma' | 'red' | 'rgba';
  kind: 'channel';
}

export interface CropEffect extends EffectBase {
  height: number;
  kind: 'crop';
  width: number;
  x: number;
  y: number;
}

export interface CanvasResizeEffect extends EffectBase {
  height: number;
  kind: 'canvas-resize';
  width: number;
  x: number;
  y: number;
}

export interface AffineEffect extends EffectBase {
  kind: 'affine';
  pivotX: number;
  pivotY: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  x: number;
  y: number;
}

export interface SharpenEffect extends EffectBase {
  amount: number;
  kind: 'sharpen';
  radius: number;
}

export interface CompositeEffect extends EffectBase {
  blend: BlendMode;
  height: number;
  kind: 'composite';
  opacity: number;
  source: ImageSource;
  width: number;
}

export type Effect =
  | AffineEffect
  | BrightnessEffect
  | TonalRangeEffect
  | BlurEffect
  | CanvasResizeEffect
  | ChannelEffect
  | ClarityEffect
  | CompositeEffect
  | ContrastEffect
  | CropEffect
  | ExposureEffect
  | GrainEffect
  | LevelsEffect
  | NoiseReductionEffect
  | OpacityEffect
  | SaturationEffect
  | SharpenEffect
  | VibranceEffect
  | VignetteEffect
  | WhiteBalanceEffect;
export type EntityMatrix = [number, number, number, number, number, number];

export interface Entity {
  blend: BlendMode;
  effects: Effect[];
  fill?: number;
  h: number;
  id: string;
  matrix?: EntityMatrix;
  opacity: number;
  mask?: EntityMask;
  source: Source;
  w: number;
  x: number;
  y: number;
}

export interface EntityMask {
  density: number;
  effects: Effect[];
  h: number;
  invert: boolean;
  matrix?: EntityMatrix;
  source: Source;
  w: number;
  x: number;
  y: number;
}

export interface Graph {
  entities: Entity[];
}

export function solid(r: number, g: number, b: number, a = 1): SolidSource {
  return { a, b, g, kind: 'solid', r };
}

export function image(
  width: number,
  height: number,
  data: Float32Array,
  revision: string,
): ImageSource {
  if (data.length !== width * height * 4) {
    throw new Error(`Image data length ${data.length} does not match ${width}x${height} RGBA`);
  }
  return { data, height, kind: 'image', revision, width };
}

export function checker(
  size: number,
  first = 0,
  second = 1,
  offsetX = 0,
  offsetY = 0,
): CheckerSource {
  return { first, kind: 'checker', offsetX, offsetY, second, size };
}

export function blur(sigma: number): BlurEffect {
  return { kind: 'blur', sigma };
}

export function levels(options: Partial<Omit<LevelsEffect, 'kind'>> = {}): LevelsEffect {
  return {
    gamma: options.gamma ?? 1,
    inBlack: options.inBlack ?? 0,
    inWhite: options.inWhite ?? 1,
    kind: 'levels',
    outBlack: options.outBlack ?? 0,
    outWhite: options.outWhite ?? 1,
  };
}

export function exposure(stops: number): ExposureEffect {
  return { kind: 'exposure', stops };
}

export function contrast(amount: number): ContrastEffect {
  return { amount, kind: 'contrast' };
}

export function saturation(amount: number): SaturationEffect {
  return { amount, kind: 'saturation' };
}

export function sharpen(radius: number, amount: number): SharpenEffect {
  return { amount, kind: 'sharpen', radius };
}

function mixText(text: string, mix: (value: number) => void): void {
  for (const character of text) mix(character.charCodeAt(0));
}

function mixSource(source: Source, mix: (value: number) => void): void {
  if (source.kind === 'checker') {
    mixText('checker', mix);
    for (const value of [
      source.size,
      source.first,
      source.second,
      source.offsetX,
      source.offsetY,
    ]) {
      mix(value * 1e6);
    }
    return;
  }
  if (source.kind === 'solid') {
    mixText('solid', mix);
    for (const value of [source.r, source.g, source.b, source.a]) mix(value * 1e6);
    return;
  }
  mixText(`image:${source.width}:${source.height}:${source.revision}`, mix);
}

function mixEffect(effect: Effect, mix: (value: number) => void): void {
  mixText(effect.kind, mix);
  if (effect.kind === 'composite') {
    mixText(effect.blend, mix);
    for (const value of [effect.opacity, effect.width, effect.height]) mix(value * 1e6);
    mixSource(effect.source, mix);
  } else {
    const parameters = { ...effect };
    delete parameters.mask;
    mixText(JSON.stringify(parameters), mix);
  }
  if (effect.mask !== undefined) mixMask(effect.mask, mix);
}

function mixMask(mask: EntityMask, mix: (value: number) => void): void {
  mixText('mask', mix);
  for (const value of [mask.x, mask.y, mask.w, mask.h, mask.density]) mix(value * 1e6);
  mix(mask.invert ? 1 : 0);
  if (mask.matrix) for (const value of mask.matrix) mix(value * 1e6);
  mixSource(mask.source, mix);
  for (const effect of mask.effects) mixEffect(effect, mix);
}

export function graphHash(graph: Graph): string {
  let hash = 2_166_136_261 >>> 0;
  const mix = (value: number): void => {
    hash ^= Math.round(value) | 0;
    hash = Math.imul(hash, 16_777_619) >>> 0;
  };
  for (const entity of graph.entities) {
    mixText(entity.id, mix);
    for (const value of [
      entity.x,
      entity.y,
      entity.w,
      entity.h,
      entity.fill ?? 1,
      entity.opacity,
    ]) {
      mix(value * 1e6);
    }
    if (entity.matrix) for (const value of entity.matrix) mix(value * 1e6);
    mixText(entity.blend, mix);
    mixSource(entity.source, mix);
    for (const effect of entity.effects) mixEffect(effect, mix);
    if (entity.mask !== undefined) mixMask(entity.mask, mix);
  }
  return hash.toString(16).padStart(8, '0');
}
