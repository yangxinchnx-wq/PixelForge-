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
  /** 源素材起始时间（秒，可选） */
  sourceStart?: number;
  /** 播放速度倍率（1.0 = 正常，可选） */
  speed?: number;
  /** 音量（0-1，可选，仅 audio 类型） */
  volume?: number;
  /** 变换属性（可选） */
  transform?: {
    x: number;
    y: number;
    scale: number;
    rotation: number;
    opacity: number;
  };
  /** 群组 ID（可选，同 groupId 的 Clip 视为一组） */
  groupId?: string;
}

export interface Track {
  id: string;
  name: string;
  type: TrackType;
  muted: boolean;
  soloed: boolean;
  locked: boolean;
  visible: boolean;
  /** 轨道高度（像素，可选，默认按类型） */
  height?: number;
  /** 轨道音量（0-1，可选，仅 audio 类型） */
  volume?: number;
  /** 轨道颜色（hex 字符串，可选） */
  color?: string;
}

// --- Keyframe / ParameterTrack 类型（从关键帧动画系统合并） ---
export type Interpolation = 'linear' | 'ease' | 'hold' | 'bezier' | 'step';

export interface Keyframe {
  id: string;
  /** 时间点（秒，>= 0） */
  time: number;
  /** 参数值 */
  value: number;
  /** 到下一个关键帧的插值方式 */
  interpolation: Interpolation;
  /** bezier 控制点 1（归一化 [0,1] x [0,1]） */
  cp1?: { x: number; y: number };
  /** bezier 控制点 2（归一化 [0,1] x [0,1]） */
  cp2?: { x: number; y: number };
}

export interface ParameterTrack {
  id: string;
  /** 显示名（中文） */
  label: string;
  /** 绑定的渲染层 ID */
  layerId: string;
  /** 绑定的参数 key */
  parameter: string;
  /** 关键帧列表（按 time 升序） */
  keyframes: Keyframe[];
}

// --- App types ---
export type TopTab = 'creation' | 'timeline' | 'preview';

export type LeftNavTab = 'input' | 'image' | 'elements' | 'effects' | 'history' | 'render' | 'performance' | 'settings';

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
