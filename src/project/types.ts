export const PIXELF_PROJECT_SCHEMA = 'pixelf.project';
export const PIXELF_PROJECT_VERSION = 4;

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type ChannelLayout = 'gray' | 'gray-alpha' | 'rgb' | 'rgba';
export type WorkingFormat = 'rgba8unorm' | 'rgba16float' | 'rgba32float';
export type ProjectColorSpace = 'srgb' | 'display-p3';
export type AuthoredColorSpace = 'automatic' | ProjectColorSpace;
export type OutputFileFormat = 'png' | 'jpeg' | 'webp';
export type OutputBitDepth = 8 | 16;
export type AlphaPolicy = 'preserve' | 'opaque';
export type CanvasBackgroundMode = 'theme' | 'light' | 'dark' | 'custom';

export interface CanvasBackgroundColor {
  a: number;
  b: number;
  g: number;
  r: number;
}

export interface CanvasBackground {
  color?: CanvasBackgroundColor;
  mode: CanvasBackgroundMode;
  visible: boolean;
}

export interface TargetContract {
  alphaPolicy: AlphaPolicy;
  channels: ChannelLayout;
  colorSpace: AuthoredColorSpace;
  height: number | null;
  outputBitDepth: OutputBitDepth;
  outputFormat: OutputFileFormat;
  width: number | null;
  workingFormat: WorkingFormat;
}

export interface ResolvedTargetContract
  extends Omit<TargetContract, 'colorSpace' | 'height' | 'width'> {
  colorSpace: ProjectColorSpace;
  height: number;
  width: number;
}

export interface BaseAsset {
  colorSpace: ProjectColorSpace;
  contentHash: string;
  height: number;
  id: string;
  kind: 'image';
  mediaType: string;
  name: string;
  width: number;
}

export interface EmbeddedImageAsset extends BaseAsset {
  bytesBase64: string;
  storage: 'embedded';
}

export interface LinkedImageAsset extends BaseAsset {
  fileName: string;
  lastModified: number;
  storage: 'linked';
}

export type ImageAsset = EmbeddedImageAsset | LinkedImageAsset;

export interface BaseNode {
  id: string;
  name: string;
  parameters: Record<string, JsonValue>;
  type: string;
}

export interface TargetNode extends BaseNode {
  background?: CanvasBackground;
  childIds: string[];
  contract: TargetContract;
  type: 'target';
}

export interface LayerNode extends BaseNode {
  childId: string | null;
  effectIds: string[];
  locked: boolean;
  type: 'layer';
  visible: boolean;
}

export interface FilterLayerNode extends BaseNode {
  filterType: `process/${string}`;
  locked: boolean;
  type: 'filter';
  visible: boolean;
}

export interface GroupNode extends BaseNode {
  childIds: string[];
  effectIds: string[];
  locked: boolean;
  type: 'group';
  visible: boolean;
}

export interface ContentLayerNode extends BaseNode {
  contentType: `content/${string}`;
  locked: boolean;
  type: 'content';
  visible: boolean;
}

export interface LayerEffectNode extends BaseNode {
  enabled: boolean;
  type: `effect/${string}`;
}

export interface ProcessorNode extends BaseNode {
  childId: string | null;
  type: `process/${string}`;
}

export interface SourceNode extends BaseNode {
  assetId?: string;
  type: `source/${string}`;
}

export type ProjectNode =
  | TargetNode
  | LayerNode
  | FilterLayerNode
  | ContentLayerNode
  | GroupNode
  | LayerEffectNode
  | ProcessorNode
  | SourceNode;
export type UnaryNode = LayerNode | ProcessorNode;
export type StackItemNode = LayerNode | FilterLayerNode | ContentLayerNode | GroupNode;

export type PortKind = 'image' | 'mask' | 'scalar';

export interface WireEndpoint {
  nodeId: string;
  port: string;
}

export interface ProjectWire {
  from: WireEndpoint;
  id: string;
  to: WireEndpoint;
}

export interface PixelfProject {
  assets: Record<string, ImageAsset>;
  name: string;
  nodes: Record<string, ProjectNode>;
  projectId: string;
  schema: typeof PIXELF_PROJECT_SCHEMA;
  targetIds: string[];
  version: typeof PIXELF_PROJECT_VERSION;
  wires: ProjectWire[];
}

export type AssetAvailability = 'available' | 'embedded' | 'missing';

export interface AssetResolverState {
  availableContentHashes: ReadonlySet<string>;
}
