import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { firstImageFile, isFileDrag } from '../src/browser/drop-image.js';

describe('image drag and drop', () => {
  it('recognizes file drags and selects the first image file', () => {
    const text = { name: 'notes.txt', type: 'text/plain' } as File;
    const image = { name: 'photo.avif', type: 'image/avif' } as File;
    const later = { name: 'later.png', type: 'image/png' } as File;
    assert.equal(isFileDrag(['text/plain', 'Files']), true);
    assert.equal(isFileDrag(['text/plain']), false);
    assert.equal(firstImageFile([text, image, later]), image);
    assert.equal(firstImageFile([text]), null);
  });
});
