export type NamingPattern =
  | '{name}_{####}'
  | '{name}_{frame}'
  | '{####}'
  | '{name}'
  | 'custom';

export type AssetMode = 'atlas' | 'images';

export interface ExportSettings {
  canvasWidth: number;
  canvasHeight: number;
  scale: number;
  fps: number;
  firstFrameOnly: boolean;
  namingPattern: NamingPattern;
  customNaming: string;
  paddingDigits: number;
  transparentBackground: boolean;
  backgroundColor: string;
  premultipliedAlpha: boolean;
}

export interface SkeletonJob {
  id: string;
  file: File;
  name: string;
  jsonText: string;
  animations: string[];
  selectedAnimation: string;
  assetMode: AssetMode;
  atlasFileName: string | null;
  imagesPath: string;
  requiredImagePaths: string[];
  missingImagePaths: string[];
  status: 'ready' | 'missing-assets' | 'error';
  error?: string;
}

export interface AssetFiles {
  /** Lowercase lookup keys → File (basename, stem, relative path, etc.) */
  byKey: Map<string, File>;
  /** All files */
  files: File[];
}

export interface ExportProgress {
  currentSkeleton: string;
  currentFrame: number;
  totalFrames: number;
  skeletonIndex: number;
  skeletonTotal: number;
  message: string;
}

export const DEFAULT_SETTINGS: ExportSettings = {
  canvasWidth: 512,
  canvasHeight: 512,
  scale: 1,
  fps: 30,
  firstFrameOnly: false,
  namingPattern: '{name}_{####}',
  customNaming: '{name}_{####}',
  paddingDigits: 4,
  transparentBackground: true,
  backgroundColor: '#000000',
  premultipliedAlpha: false,
};
