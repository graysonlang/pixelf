import type { ProjectColorSpace } from '../project/types.js';
import type { GpuContext } from './device.js';

export interface PresentTarget {
  canvas: HTMLCanvasElement;
  colorSpace: ProjectColorSpace;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
  viewFormat: GPUTextureFormat;
}

export function srgbViewFormat(format: GPUTextureFormat): GPUTextureFormat {
  if (format === 'bgra8unorm') return 'bgra8unorm-srgb';
  if (format === 'rgba8unorm') return 'rgba8unorm-srgb';
  return format;
}

export function attachCanvas(
  gpu: GpuContext,
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  colorSpace: ProjectColorSpace,
): PresentTarget {
  const context = canvas.getContext('webgpu');
  if (context === null) throw new Error('The canvas could not create a WebGPU context');
  canvas.width = width;
  canvas.height = height;
  const format = gpu.preferredCanvasFormat;
  const viewFormat = srgbViewFormat(format);
  context.configure({
    alphaMode: 'premultiplied',
    colorSpace,
    device: gpu.device,
    format,
    viewFormats: viewFormat === format ? [] : [viewFormat],
  });
  return { canvas, colorSpace, context, format, viewFormat };
}
