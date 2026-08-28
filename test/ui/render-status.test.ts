import assert from 'node:assert/strict';
import test from 'node:test';
import type { GpuContext, GpuDeviceState } from '../../src/gpu/device.js';
import { renderingStatusMessage } from '../../src/ui/render-status.js';

test('rendering status keeps routine device states out of the common interface', () => {
  const states: readonly GpuDeviceState[] = [
    { kind: 'idle' },
    { kind: 'acquiring' },
    { context: {} as GpuContext, generation: 1, kind: 'ready' },
  ];
  assert.deepEqual(states.map(renderingStatusMessage), ['', '', '']);
});

test('rendering status translates device failures into backend-neutral guidance', () => {
  assert.equal(
    renderingStatusMessage({ kind: 'unsupported', message: 'WebGPU is unavailable' }),
    'Live edit preview is unavailable in this browser. Pixelf can still display the source image.',
  );
  assert.equal(
    renderingStatusMessage({ generation: 2, kind: 'lost', message: 'GPU device lost' }),
    'Live edit preview was interrupted. Pixelf is reconnecting.',
  );
});
