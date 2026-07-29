/* ==========================================================
   PixelForge Types
   ========================================================== */

// --- Timeline types (from 新建文件夹) ---
export type TrackType = 'video' | 'audio' | 'text';
export type ClipType = 'video' | 'audio' | 'text';
export type Theme = 'light' | 'dark';

export interface Clip {
  id: string;
  trackId: string;
  name: string;
  start: number;      // seconds
  duration: number;   // seconds
  type: ClipType;
}

export interface Track {
  id: string;
  name: string;
  type: TrackType;
  muted: boolean;
  soloed: boolean;
  locked: boolean;
  visible: boolean;
}

// --- App types ---
export type TopTab = 'creation' | 'timeline' | 'preview';

export type LeftNavTab = 'input' | 'scene' | 'elements' | 'effects' | 'history' | 'render' | 'performance' | 'settings';

export interface AssetItem {
  id: string;
  label: string;
  type: 'video' | 'image' | '3d' | 'audio';
  category?: 'character' | 'environment' | 'particles' | 'light' | 'overlay';
  resolution: string;
  format: string;
  generationDate: string;
  size: string;
  duration?: string;
  fps?: string;
  prompt?: string;
  thumbnailUrl?: string;
  active?: boolean;
}

export interface TuningParams {
  starDensity: number;
  brightness: number;
  hue: number;
  contrast: number;
}

export interface IRTreeNode {
  id: string;
  name: string;
  enName?: string;
  color?: string;
  type: string;
  children?: IRTreeNode[];
  visible?: boolean;
  [key: string]: any;
}

export interface FrameItem {
  id: number;
  frameIndex: number;
  timecode: string;
  thumbnailUrl?: string;
}

export type EditorViewMode = 'regional' | 'depth' | 'pointcloud' | 'edge';

export interface PresetStyle {
  id: string;
  name: string;
  badge: string;
  thumbnailUrl: string;
  description: string;
  prompt: string;
  tuningParams: TuningParams;
}

export interface ElementTag {
  id: string;
  name: string;
  type: string;
  active: boolean;
  visible?: boolean;
  locked?: boolean;
  opacity?: number;
  blendMode?: string;
  properties?: Record<string, any>;
}
