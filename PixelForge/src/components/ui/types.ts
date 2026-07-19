export type StatusTone = 'idle' | 'initializing' | 'ready' | 'error'

export type DataRecord = {
  label: string
  value: string
}

export type DataSection = {
  title: string
  rows: DataRecord[]
}

export type RenderVerificationState = '未校验' | '一致' | '不一致'

export type TimelineFrame = {
  frame: number
  label: string
  patchSummary: string
  durationMs: number
  hasPatch: boolean
  isKeyframe: boolean
  status: StatusTone
  renderVerificationState: RenderVerificationState
}

export interface FrameSnapshot {
  frame: number
  label: string
  timestampMs: number
  durationMs: number
  status: StatusTone
  scenario: string
  layerId: string | null
  opcode: string | null
  patchId: string | null
  patchSummary: string | null
  hasPatch: boolean
  isKeyframe: boolean
  canvasSize: {
    width: number
    height: number
  } | null
  outputFormat: string | null
  error: string | null
  artifactSchemaVersion: string | null
  renderVerificationState: RenderVerificationState
  renderVerificationMessage: string | null
  payload: Record<string, unknown>
}

export interface PlaybackState {
  currentFrame: number | null
  presentedFrame: number | null
  isPlaying: boolean
  canPlay: boolean
  canStepForward: boolean
  canStepBackward: boolean
  frameCount: number
}

export interface TimelineDataSource {
  getFrames(): FrameSnapshot[]
  getCurrentFrame(): number
  selectFrame(frame: number): void
}
