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

export type Effect = BlurEffect | LevelsEffect;
export type EntityMatrix = [number, number, number, number, number, number];

export interface Entity {
  blend: BlendMode;
  effects: Effect[];
  h: number;
  id: string;
  matrix?: EntityMatrix;
  opacity: number;
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

function mixText(text: string, mix: (value: number) => void): void {
  for (const character of text) mix(character.charCodeAt(0));
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
    if (entity.source.kind === 'solid') {
      mixText('solid', mix);
      for (const value of [entity.source.r, entity.source.g, entity.source.b, entity.source.a]) {
        mix(value * 1e6);
      }
    } else {
      mixText(
        `image:${entity.source.width}:${entity.source.height}:${entity.source.revision}`,
        mix,
      );
    }
    for (const effect of entity.effects) {
      mixText(effect.kind, mix);
      if (effect.kind === 'blur') mix(effect.sigma * 1e6);
      else {
        for (const value of [
          effect.inBlack,
          effect.inWhite,
          effect.gamma,
          effect.outBlack,
          effect.outWhite,
        ]) {
          mix(value * 1e6);
        }
      }
    }
  }
  return hash.toString(16).padStart(8, '0');
}
