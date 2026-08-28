import type { GpuDeviceState } from '../gpu/device.js';

export function renderingStatusMessage(state: GpuDeviceState): string {
  switch (state.kind) {
    case 'idle':
    case 'acquiring':
    case 'ready':
      return '';
    case 'unsupported':
      return 'Live edit preview is unavailable in this browser. Pixelf can still display the source image.';
    case 'lost':
      return 'Live edit preview was interrupted. Pixelf is reconnecting.';
  }
}
