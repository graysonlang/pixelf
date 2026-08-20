export const HYBRID_NEAREST_START = 2;
export const HYBRID_NEAREST_END = 6;

export interface ViewportPresentation {
  cssHeight: number;
  cssWidth: number;
  panX: number;
  panY: number;
  zoom: number;
}

export interface DeviceProjection {
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
  scissor: { height: number; width: number; x: number; y: number } | null;
}

function smoothstep(start: number, end: number, value: number): number {
  const amount = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return amount * amount * (3 - 2 * amount);
}

function isNearIntegerMagnification(magnification: number): boolean {
  const integer = Math.round(magnification);
  return integer >= 1 && Math.abs(magnification - integer) < 0.002 * integer;
}

export function hybridNearestBlend(magnification: number): number {
  if (isNearIntegerMagnification(magnification)) return 1;
  return smoothstep(HYBRID_NEAREST_START, HYBRID_NEAREST_END, magnification);
}

export function previewDeviceProjection(
  viewport: ViewportPresentation,
  outputWidth: number,
  outputHeight: number,
  targetWidth: number,
  targetHeight: number,
): DeviceProjection {
  const cssWidth = Math.max(1, viewport.cssWidth);
  const cssHeight = Math.max(1, viewport.cssHeight);
  const scaleX = viewport.zoom * (outputWidth / cssWidth);
  const scaleY = viewport.zoom * (outputHeight / cssHeight);
  const offsetX =
    outputWidth / 2 + viewport.panX * (outputWidth / cssWidth) - (targetWidth * scaleX) / 2;
  const offsetY =
    outputHeight / 2 + viewport.panY * (outputHeight / cssHeight) - (targetHeight * scaleY) / 2;
  const left = Math.max(0, Math.floor(offsetX));
  const top = Math.max(0, Math.floor(offsetY));
  const right = Math.min(outputWidth, Math.ceil(offsetX + targetWidth * scaleX));
  const bottom = Math.min(outputHeight, Math.ceil(offsetY + targetHeight * scaleY));
  return {
    offsetX,
    offsetY,
    scaleX,
    scaleY,
    scissor:
      right > left && bottom > top
        ? { height: bottom - top, width: right - left, x: left, y: top }
        : null,
  };
}

export function projectImagePlacement(
  placement: readonly [number, number, number, number, number, number],
  projection: DeviceProjection,
  entityWidth: number,
  entityHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): readonly [number, number, number, number, number, number] {
  const [a, b, c, d, e, f] = placement;
  const projected: [number, number, number, number, number, number] = [
    a * projection.scaleX,
    b * projection.scaleY,
    c * projection.scaleX,
    d * projection.scaleY,
    e * projection.scaleX + projection.offsetX,
    f * projection.scaleY + projection.offsetY,
  ];
  const texelScaleX = projected[0] * (entityWidth / sourceWidth);
  const texelScaleY = projected[3] * (entityHeight / sourceHeight);
  if (
    Math.abs(projected[1]) < 1e-6 &&
    Math.abs(projected[2]) < 1e-6 &&
    isNearIntegerMagnification(texelScaleX) &&
    isNearIntegerMagnification(texelScaleY)
  ) {
    projected[4] = Math.round(projected[4]);
    projected[5] = Math.round(projected[5]);
  }
  return projected;
}
