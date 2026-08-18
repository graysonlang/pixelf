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

export type Source = ImageSource | SolidSource;
export type BlendMode = 'add' | 'darken' | 'lighten' | 'multiply' | 'normal' | 'overlay' | 'screen';

export interface BlurEffect {
  kind: 'blur';
  sigma: number;
}

export interface LevelsEffect {
  gamma: number;
  inBlack: number;
  inWhite: number;
  kind: 'levels';
  outBlack: number;
  outWhite: number;
}

export interface ExposureEffect {
  kind: 'exposure';
  stops: number;
}

export interface WhiteBalanceEffect {
  kind: 'white-balance';
  temperature: number;
  tint: number;
}

export interface ContrastEffect {
  amount: number;
  kind: 'contrast';
}

export interface SaturationEffect {
  amount: number;
  kind: 'saturation';
}

export interface ChannelEffect {
  channel: 'alpha' | 'blue' | 'green' | 'luma' | 'red' | 'rgba';
  kind: 'channel';
}

export interface CropEffect {
  height: number;
  kind: 'crop';
  width: number;
  x: number;
  y: number;
}

export interface CanvasResizeEffect {
  height: number;
  kind: 'canvas-resize';
  width: number;
  x: number;
  y: number;
}

export interface AffineEffect {
  kind: 'affine';
  pivotX: number;
  pivotY: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  x: number;
  y: number;
}

export interface SharpenEffect {
  amount: number;
  kind: 'sharpen';
  radius: number;
}

export type Effect =
  | AffineEffect
  | BlurEffect
  | CanvasResizeEffect
  | ChannelEffect
  | ContrastEffect
  | CropEffect
  | ExposureEffect
  | LevelsEffect
  | SaturationEffect
  | SharpenEffect
  | WhiteBalanceEffect;
export type EntityMatrix = [number, number, number, number, number, number];

export interface Entity {
  blend: BlendMode;
  effects: Effect[];
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
  if (source.kind === 'solid') {
    mixText('solid', mix);
    for (const value of [source.r, source.g, source.b, source.a]) mix(value * 1e6);
    return;
  }
  mixText(`image:${source.width}:${source.height}:${source.revision}`, mix);
}

function mixEffect(effect: Effect, mix: (value: number) => void): void {
  mixText(effect.kind, mix);
  mixText(JSON.stringify(effect), mix);
}

export function graphHash(graph: Graph): string {
  let hash = 2_166_136_261 >>> 0;
  const mix = (value: number): void => {
    hash ^= Math.round(value) | 0;
    hash = Math.imul(hash, 16_777_619) >>> 0;
  };
  for (const entity of graph.entities) {
    mixText(entity.id, mix);
    for (const value of [entity.x, entity.y, entity.w, entity.h, entity.opacity]) mix(value * 1e6);
    if (entity.matrix) for (const value of entity.matrix) mix(value * 1e6);
    mixText(entity.blend, mix);
    mixSource(entity.source, mix);
    for (const effect of entity.effects) mixEffect(effect, mix);
    if (entity.mask !== undefined) {
      mixText('mask', mix);
      for (const value of [
        entity.mask.x,
        entity.mask.y,
        entity.mask.w,
        entity.mask.h,
        entity.mask.density,
      ]) {
        mix(value * 1e6);
      }
      mix(entity.mask.invert ? 1 : 0);
      if (entity.mask.matrix) for (const value of entity.mask.matrix) mix(value * 1e6);
      mixSource(entity.mask.source, mix);
      for (const effect of entity.mask.effects) mixEffect(effect, mix);
    }
  }
  return hash.toString(16).padStart(8, '0');
}
