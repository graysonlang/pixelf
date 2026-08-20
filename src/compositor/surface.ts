import type { BlendMode } from './graph.js';

export interface Region {
  h: number;
  w: number;
  x: number;
  y: number;
}

export interface Surface {
  data: Float32Array;
  region: Region;
}

export function makeSurface(region: Region): Surface {
  if (![region.x, region.y, region.w, region.h].every(Number.isInteger)) {
    throw new Error('Surface regions must use integer pixel coordinates');
  }
  if (region.w < 0 || region.h < 0) throw new Error('Surface dimensions cannot be negative');
  return { data: new Float32Array(region.w * region.h * 4), region: { ...region } };
}

export function expandRegion(region: Region, radius: number): Region {
  const amount = Math.max(0, Math.ceil(radius));
  return {
    h: region.h + amount * 2,
    w: region.w + amount * 2,
    x: region.x - amount,
    y: region.y - amount,
  };
}

export function intersectRegion(left: Region, right: Region): Region | null {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const rightEdge = Math.min(left.x + left.w, right.x + right.w);
  const bottomEdge = Math.min(left.y + left.h, right.y + right.h);
  if (rightEdge <= x || bottomEdge <= y) return null;
  return { h: bottomEdge - y, w: rightEdge - x, x, y };
}

export function readPremul(surface: Surface, x: number, y: number, output: Float32Array): void {
  const localX = x - surface.region.x;
  const localY = y - surface.region.y;
  if (localX < 0 || localY < 0 || localX >= surface.region.w || localY >= surface.region.h) {
    output.fill(0);
    return;
  }
  const offset = (localY * surface.region.w + localX) * 4;
  output[0] = surface.data[offset] ?? 0;
  output[1] = surface.data[offset + 1] ?? 0;
  output[2] = surface.data[offset + 2] ?? 0;
  output[3] = surface.data[offset + 3] ?? 0;
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function colorBurn(backdrop: number, source: number): number {
  return source <= 0 ? 0 : 1 - Math.min(1, (1 - backdrop) / source);
}

function colorDodge(backdrop: number, source: number): number {
  return source >= 1 ? 1 : Math.min(1, backdrop / (1 - source));
}

function softLight(backdrop: number, source: number): number {
  if (source <= 0.5) return backdrop - (1 - 2 * source) * backdrop * (1 - backdrop);
  const curve =
    backdrop <= 0.25 ? ((16 * backdrop - 12) * backdrop + 4) * backdrop : Math.sqrt(backdrop);
  return backdrop + (2 * source - 1) * (curve - backdrop);
}

function blendChannel(mode: BlendMode, backdrop: number, source: number): number {
  switch (mode) {
    case 'normal':
    case 'dissolve':
      return source;
    case 'multiply':
      return backdrop * source;
    case 'screen':
      return backdrop + source - backdrop * source;
    case 'overlay':
      return backdrop <= 0.5 ? 2 * backdrop * source : 1 - 2 * (1 - backdrop) * (1 - source);
    case 'darken':
      return Math.min(backdrop, source);
    case 'lighten':
      return Math.max(backdrop, source);
    case 'color-burn':
      return colorBurn(backdrop, source);
    case 'linear-burn':
      return Math.max(0, backdrop + source - 1);
    case 'color-dodge':
      return colorDodge(backdrop, source);
    case 'linear-dodge':
    case 'add':
      return Math.min(1, backdrop + source);
    case 'soft-light':
      return softLight(backdrop, source);
    case 'hard-light':
      return source <= 0.5 ? 2 * backdrop * source : 1 - 2 * (1 - backdrop) * (1 - source);
    case 'vivid-light':
      return source <= 0.5 ? colorBurn(backdrop, source * 2) : colorDodge(backdrop, source * 2 - 1);
    case 'linear-light':
      return clampUnit(backdrop + 2 * source - 1);
    case 'pin-light':
      return source <= 0.5 ? Math.min(backdrop, source * 2) : Math.max(backdrop, source * 2 - 1);
    case 'hard-mix':
      return blendChannel('vivid-light', backdrop, source) < 0.5 ? 0 : 1;
    case 'difference':
      return Math.abs(backdrop - source);
    case 'exclusion':
      return backdrop + source - 2 * backdrop * source;
    case 'subtract':
      return Math.max(0, backdrop - source);
    case 'divide':
      return source <= 0 ? 1 : Math.min(1, backdrop / source);
    case 'darker-color':
    case 'lighter-color':
    case 'hue':
    case 'saturation':
    case 'color':
    case 'luminosity':
      return source;
  }
}

type Color = [number, number, number];

function luminosity(color: Color): number {
  return color[0] * 0.3 + color[1] * 0.59 + color[2] * 0.11;
}

function clipColor(color: Color): Color {
  const light = luminosity(color);
  const minimum = Math.min(...color);
  const maximum = Math.max(...color);
  let output = color;
  if (minimum < 0) {
    output = output.map(value => light + ((value - light) * light) / (light - minimum)) as Color;
  }
  if (maximum > 1) {
    output = output.map(
      value => light + ((value - light) * (1 - light)) / (maximum - light),
    ) as Color;
  }
  return output;
}

function setLuminosity(color: Color, light: number): Color {
  const delta = light - luminosity(color);
  return clipColor(color.map(value => value + delta) as Color);
}

function saturation(color: Color): number {
  return Math.max(...color) - Math.min(...color);
}

function setSaturation(color: Color, amount: number): Color {
  const indexed = color.map((value, index) => ({ index, value })).sort((a, b) => a.value - b.value);
  const minimum = indexed[0];
  const middle = indexed[1];
  const maximum = indexed[2];
  if (minimum === undefined || middle === undefined || maximum === undefined) return color;
  const output: Color = [0, 0, 0];
  if (maximum.value > minimum.value) {
    output[middle.index] =
      ((middle.value - minimum.value) * amount) / (maximum.value - minimum.value);
    output[maximum.index] = amount;
  }
  output[minimum.index] = 0;
  return output;
}

function blendColor(mode: BlendMode, backdrop: Color, source: Color): Color {
  if (mode === 'darker-color' || mode === 'lighter-color') {
    const sourceIsChosen =
      mode === 'darker-color'
        ? luminosity(source) < luminosity(backdrop)
        : luminosity(source) > luminosity(backdrop);
    return sourceIsChosen ? source : backdrop;
  }
  if (mode === 'hue') {
    return setLuminosity(setSaturation(source, saturation(backdrop)), luminosity(backdrop));
  }
  if (mode === 'saturation') {
    return setLuminosity(setSaturation(backdrop, saturation(source)), luminosity(backdrop));
  }
  if (mode === 'color') return setLuminosity(source, luminosity(backdrop));
  if (mode === 'luminosity') return setLuminosity(backdrop, luminosity(source));
  return backdrop.map((value, channel) => blendChannel(mode, value, source[channel] ?? 0)) as Color;
}

function randomAt(x: number, y: number): number {
  let value = Math.imul(x | 0, 0x1f123bb5) ^ Math.imul(y | 0, 0x5f356495) ^ 0x68bc21eb;
  value = Math.imul(value ^ (value >>> 15), 0x2c1b3c6d);
  value = Math.imul(value ^ (value >>> 12), 0x297a2d39);
  return ((value ^ (value >>> 15)) >>> 0) / 4_294_967_296;
}

export function blendOnto(backdrop: Surface, source: Surface, mode: BlendMode): void {
  if (
    backdrop.region.x !== source.region.x ||
    backdrop.region.y !== source.region.y ||
    backdrop.region.w !== source.region.w ||
    backdrop.region.h !== source.region.h
  ) {
    throw new Error('Blend surfaces must cover the same region');
  }
  for (let offset = 0; offset < backdrop.data.length; offset += 4) {
    const pixelIndex = offset / 4;
    const x = backdrop.region.x + (pixelIndex % backdrop.region.w);
    const y = backdrop.region.y + Math.floor(pixelIndex / backdrop.region.w);
    const storedSourceAlpha = source.data[offset + 3] ?? 0;
    const sourceAlpha =
      mode === 'dissolve' ? (randomAt(x, y) < storedSourceAlpha ? 1 : 0) : storedSourceAlpha;
    const backdropAlpha = backdrop.data[offset + 3] ?? 0;
    const outputAlpha = sourceAlpha + backdropAlpha - sourceAlpha * backdropAlpha;
    const sourceStraight: Color = [
      storedSourceAlpha > 0 ? (source.data[offset] ?? 0) / storedSourceAlpha : 0,
      storedSourceAlpha > 0 ? (source.data[offset + 1] ?? 0) / storedSourceAlpha : 0,
      storedSourceAlpha > 0 ? (source.data[offset + 2] ?? 0) / storedSourceAlpha : 0,
    ];
    const backdropStraight: Color = [
      backdropAlpha > 0 ? (backdrop.data[offset] ?? 0) / backdropAlpha : 0,
      backdropAlpha > 0 ? (backdrop.data[offset + 1] ?? 0) / backdropAlpha : 0,
      backdropAlpha > 0 ? (backdrop.data[offset + 2] ?? 0) / backdropAlpha : 0,
    ];
    const blended = blendColor(mode, backdropStraight, sourceStraight);
    for (let channel = 0; channel < 3; channel += 1) {
      const sourcePremul = (sourceStraight[channel] ?? 0) * sourceAlpha;
      const backdropPremul = backdrop.data[offset + channel] ?? 0;
      backdrop.data[offset + channel] =
        (1 - sourceAlpha) * backdropPremul +
        (1 - backdropAlpha) * sourcePremul +
        sourceAlpha * backdropAlpha * (blended[channel] ?? 0);
    }
    backdrop.data[offset + 3] = outputAlpha;
  }
}

export function over(backdrop: Surface, source: Surface): void {
  blendOnto(backdrop, source, 'normal');
}

export function cropSurface(surface: Surface, region: Region): Surface {
  const output = makeSurface(region);
  const pixel = new Float32Array(4);
  for (let y = 0; y < region.h; y += 1) {
    for (let x = 0; x < region.w; x += 1) {
      readPremul(surface, region.x + x, region.y + y, pixel);
      output.data.set(pixel, (y * region.w + x) * 4);
    }
  }
  return output;
}
