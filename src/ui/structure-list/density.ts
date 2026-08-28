export type Density = 'compact' | 'expanded' | 'micro' | 'standard';

export interface DensityRequest {
  availableWidth: number;
  desiredRowHeight: number;
}

export interface DensityPolicy {
  density: Density;
  railCapacity: number;
  rowHeight: number;
  showMetadata: boolean;
  thumbnailSize: number;
}

const POLICIES: Readonly<Record<Density, DensityPolicy>> = Object.freeze({
  micro: {
    density: 'micro',
    railCapacity: 0,
    rowHeight: 44,
    showMetadata: false,
    thumbnailSize: 0,
  },
  compact: {
    density: 'compact',
    railCapacity: 2,
    rowHeight: 48,
    showMetadata: false,
    thumbnailSize: 28,
  },
  standard: {
    density: 'standard',
    railCapacity: 4,
    rowHeight: 64,
    showMetadata: true,
    thumbnailSize: 42,
  },
  expanded: {
    density: 'expanded',
    railCapacity: Number.POSITIVE_INFINITY,
    rowHeight: 88,
    showMetadata: true,
    thumbnailSize: 64,
  },
});

export function densityPolicy(request: DensityRequest): DensityPolicy {
  const width = Math.max(0, request.availableWidth);
  const height = Math.max(0, request.desiredRowHeight);
  if (width < 240 || height < 44) return POLICIES.micro;
  if (width < 280 || height < 60) return POLICIES.compact;
  if (width < 420 || height < 80) return POLICIES.standard;
  return POLICIES.expanded;
}

export function policyForDensity(density: Density): DensityPolicy {
  return POLICIES[density];
}
