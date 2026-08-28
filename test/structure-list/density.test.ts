import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { densityPolicy, policyForDensity } from '../../src/ui/structure-list/index.js';

describe('structure list density', () => {
  it('uses both inline space and row height to choose a tier', () => {
    assert.equal(densityPolicy({ availableWidth: 200, desiredRowHeight: 90 }).density, 'micro');
    assert.equal(densityPolicy({ availableWidth: 260, desiredRowHeight: 64 }).density, 'compact');
    assert.equal(densityPolicy({ availableWidth: 320, desiredRowHeight: 64 }).density, 'standard');
    assert.equal(densityPolicy({ availableWidth: 480, desiredRowHeight: 90 }).density, 'expanded');
    assert.equal(densityPolicy({ availableWidth: 480, desiredRowHeight: 40 }).density, 'micro');
  });

  it('keeps micro rows touchable while suppressing raster work', () => {
    const micro = policyForDensity('micro');
    assert.equal(micro.rowHeight, 44);
    assert.equal(micro.thumbnailSize, 0);
    assert.equal(micro.railCapacity, 0);
    assert.equal(micro.showMetadata, false);
  });
});
