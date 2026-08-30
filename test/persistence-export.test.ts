import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inflateSync } from 'node:zlib';
import { image, projectTargetToGraph, renderRegion, type Graph } from '../src/compositor/index.js';
import {
  artifactBytes,
  buildExportPlan,
  exportTargetPng,
  exportTargetWithBrowserEncoder,
} from '../src/export/index.js';
import {
  createEmbeddedImageAsset,
  createImportedProject,
  createLinkedImageAsset,
  NamedProjectSession,
  openProjectFile,
  ProjectRecoveryStore,
  relinkMissingAsset,
  serializeProject,
  type PixelfProject,
  type RecoveryStorage,
  type ResolvedTargetContract,
} from '../src/project/index.js';

function projectFixture(): PixelfProject {
  const asset = createEmbeddedImageAsset({
    bytesBase64: 'AAE=',
    contentHash: `sha256:${'7'.repeat(64)}`,
    height: 1,
    id: 'asset-persisted',
    mediaType: 'image/png',
    name: 'Persisted',
    width: 2,
  });
  return createImportedProject(asset, {
    layerId: 'node-layer',
    projectId: 'project-persisted',
    sourceId: 'node-source',
    targetId: 'node-target',
  });
}

function graphFixture(): Graph {
  return {
    entities: [
      {
        blend: 'normal',
        effects: [],
        h: 1,
        id: 'export-source',
        opacity: 1,
        source: image(2, 1, new Float32Array([1, 0, 0, 0.5, 0, 1, 0, 1]), 'export'),
        w: 2,
        x: 0,
        y: 0,
      },
    ],
  };
}

function contract(overrides: Partial<ResolvedTargetContract> = {}): ResolvedTargetContract {
  return {
    alphaPolicy: 'preserve',
    channels: 'rgba',
    colorSpace: 'srgb',
    height: 1,
    outputBitDepth: 8,
    outputFormat: 'png',
    width: 2,
    workingFormat: 'rgba16float',
    ...overrides,
  };
}

interface ParsedChunk {
  data: Uint8Array;
  type: string;
}

function parsePng(bytes: Uint8Array): ParsedChunk[] {
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks: ParsedChunk[] = [];
  const decoder = new TextDecoder();
  for (let offset = 8; offset < bytes.length; ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
    const length = view.getUint32(0);
    const type = decoder.decode(bytes.subarray(offset + 4, offset + 8));
    chunks.push({ data: bytes.slice(offset + 8, offset + 8 + length), type });
    offset += 12 + length;
  }
  return chunks;
}

function pngRows(chunks: readonly ParsedChunk[]): Uint8Array {
  const parts = chunks.filter(chunk => chunk.type === 'IDAT').map(chunk => chunk.data);
  const length = parts.reduce((total, part) => total + part.length, 0);
  const compressed = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    compressed.set(part, offset);
    offset += part.length;
  }
  return inflateSync(compressed);
}

class MemoryStorage implements RecoveryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('durable projects and faithful export', () => {
  it('opens and saves byte-stable named projects with deterministic reference pixels', async () => {
    const project = projectFixture();
    let written = '';
    const receipt = await new NamedProjectSession(
      project,
      new ProjectRecoveryStore(new MemoryStorage()),
    ).saveAs({
      name: 'persisted.pixelf',
      writeText: async source => {
        written = source;
      },
    });
    const reopened = await openProjectFile({
      name: 'persisted.pixelf',
      readText: async () => written,
    });
    assert.equal(written, serializeProject(project));
    assert.equal(receipt.destinationName, 'persisted.pixelf');
    assert.deepEqual(reopened, project);

    const decoded = new Map([
      [
        'asset-persisted',
        {
          data: new Float32Array([1, 0, 0, 1, 0, 1, 0, 1]),
          height: 1,
          revision: 'stable',
          width: 2,
        },
      ],
    ]);
    const before = projectTargetToGraph(project, 'node-target', decoded).graph;
    const after = projectTargetToGraph(reopened, 'node-target', decoded).graph;
    assert.deepEqual(
      [...renderRegion(after, { h: 1, w: 2, x: 0, y: 0 }, 1).data],
      [...renderRegion(before, { h: 1, w: 2, x: 0, y: 0 }, 1).data],
    );
  });

  it('keeps recovery separate and never overwrites a named file without save', async () => {
    const storage = new MemoryStorage();
    const recovery = new ProjectRecoveryStore(storage);
    const session = new NamedProjectSession(projectFixture(), recovery);
    let writes = 0;
    await session.saveAs({
      name: 'named.pixelf',
      writeText: async () => {
        writes += 1;
      },
    });
    const changed = session.project;
    changed.name = 'Recovered title';
    session.replaceProject(changed);
    assert.equal(writes, 1);
    assert.equal(session.restoreRecovery(changed.projectId)?.name, 'Recovered title');
    assert.equal(writes, 1);
    await session.save();
    assert.equal(writes, 2);
    assert.equal(recovery.load(changed.projectId), null);
  });

  it('relinks only a matching missing linked asset identity', () => {
    const project = projectFixture();
    const linked = createLinkedImageAsset({
      contentHash: `sha256:${'8'.repeat(64)}`,
      fileName: 'old.png',
      height: 10,
      id: 'asset-linked',
      lastModified: 1,
      mediaType: 'image/png',
      name: 'Linked',
      width: 20,
    });
    project.assets[linked.id] = linked;
    const resolver = { availableContentHashes: new Set<string>() };
    const relinked = relinkMissingAsset(
      project,
      linked.id,
      {
        contentHash: linked.contentHash,
        fileName: 'found.png',
        height: 10,
        lastModified: 2,
        width: 20,
      },
      resolver,
    );
    const relinkedAsset = relinked.assets[linked.id];
    assert.equal(relinkedAsset?.storage, 'linked');
    assert.equal(relinkedAsset?.storage === 'linked' ? relinkedAsset.fileName : '', 'found.png');
    assert.throws(
      () =>
        relinkMissingAsset(
          project,
          linked.id,
          {
            contentHash: `sha256:${'9'.repeat(64)}`,
            fileName: 'wrong.png',
            height: 10,
            lastModified: 2,
            width: 20,
          },
          resolver,
        ),
      /does not match/,
    );
  });

  it('exports tiled 8-bit PNG with target dimensions, alpha, color, and metadata policy', () => {
    const artifact = exportTargetPng(graphFixture(), contract(), {
      metadata: { Author: 'Pixelf test' },
      metadataPolicy: 'rewrite',
      tileWidth: 1,
    });
    const chunks = parsePng(artifactBytes(artifact));
    const header = chunks.find(chunk => chunk.type === 'IHDR')?.data;
    assert.ok(header);
    assert.equal(new DataView(header.buffer, header.byteOffset).getUint32(0), 2);
    assert.equal(new DataView(header.buffer, header.byteOffset).getUint32(4), 1);
    assert.equal(header[8], 8);
    assert.equal(header[9], 6);
    assert.ok(chunks.some(chunk => chunk.type === 'sRGB'));
    assert.ok(chunks.some(chunk => chunk.type === 'tEXt'));
    assert.deepEqual([...pngRows(chunks)], [0, 255, 0, 0, 128, 0, 255, 0, 255]);
  });

  it('exports 16-bit Display P3 and applies opaque-black alpha policy explicitly', () => {
    const preserved = exportTargetPng(
      graphFixture(),
      contract({ colorSpace: 'display-p3', outputBitDepth: 16 }),
      { tileWidth: 1 },
    );
    const preservedChunks = parsePng(artifactBytes(preserved));
    const header = preservedChunks.find(chunk => chunk.type === 'IHDR')?.data;
    assert.equal(header?.[8], 16);
    assert.equal(header?.[9], 6);
    assert.deepEqual(
      [...(preservedChunks.find(chunk => chunk.type === 'cICP')?.data ?? [])],
      [12, 13, 0, 1],
    );
    assert.equal(pngRows(preservedChunks).length, 1 + 2 * 4 * 2);

    const opaque = exportTargetPng(
      graphFixture(),
      contract({ alphaPolicy: 'opaque', channels: 'rgb' }),
    );
    const opaqueChunks = parsePng(artifactBytes(opaque));
    assert.equal(opaqueChunks.find(chunk => chunk.type === 'IHDR')?.data[9], 2);
    assert.deepEqual([...pngRows(opaqueChunks)], [0, 188, 0, 0, 0, 255, 0]);
  });

  it('makes JPEG and WebP browser limits, alpha, precision, and metadata choices explicit', async () => {
    const jpegContract = contract({
      alphaPolicy: 'opaque',
      channels: 'rgb',
      outputFormat: 'jpeg',
    });
    const plan = buildExportPlan(jpegContract, 'discard');
    assert.deepEqual(
      [plan.encoder, plan.bitDepth, plan.alpha, plan.metadataPolicy],
      ['browser-raster', 8, 'opaque-black', 'discard'],
    );
    let receivedMime = '';
    const artifact = await exportTargetWithBrowserEncoder(graphFixture(), jpegContract, {
      encode: async (_rgba, _width, _height, options) => {
        receivedMime = options.mimeType;
        return new Uint8Array([1, 2, 3]);
      },
    });
    assert.equal(receivedMime, 'image/jpeg');
    assert.equal(artifact.extension, 'jpg');
    assert.throws(
      () => buildExportPlan({ ...jpegContract, outputBitDepth: 16 }, 'preserve'),
      /8-bit/,
    );
    await assert.rejects(
      () =>
        exportTargetWithBrowserEncoder(
          graphFixture(),
          jpegContract,
          {
            encode: async () => new Uint8Array(),
          },
          { maximumPixels: 1 },
        ),
      /cannot stream/,
    );
  });
});
