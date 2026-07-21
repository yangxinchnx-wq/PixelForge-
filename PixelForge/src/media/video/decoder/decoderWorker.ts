/**
 * PixelForge Media Video — DecoderWorker（解码 Worker）。
 *
 * 在 Web Worker 中运行 VideoDecoder，不阻塞 UI 主线程。
 *
 * 主线程 → postMessage → Worker → 解码 → VideoFrame → postMessage → 主线程
 *
 * Worker 消息协议：
 *   主线程 → Worker:  { type: 'configure', config }
 *                       { type: 'decode', chunk }
 *                       { type: 'seek', time }
 *                       { type: 'destroy' }
 *   Worker → 主线程:  { type: 'frame', frame }
 *                       { type: 'error', message }
 */

import { PixelVideoDecoder, type DecoderConfig } from './videoDecoder';
import type { DemuxedChunk } from '../demux/mp4Demuxer';

/** Worker 消息类型（主线程 → Worker）。 */
export interface WorkerRequest {
  type: 'configure' | 'decode' | 'seek' | 'destroy';
  config?: DecoderConfig;
  chunk?: DemuxedChunk;
  time?: number;
}

/** Worker 消息类型（Worker → 主线程）。 */
export interface WorkerResponse {
  type: 'frame' | 'error' | 'ready';
  frame?: VideoFrame;
  message?: string;
}

/** Worker 上下文类型（避免直接使用 Worker 类型）。 */
interface WorkerContext {
  postMessage: (msg: WorkerResponse, transfer?: Transferable[]) => void;
  close: () => void;
}

/**
 * 创建解码 Worker 上下文。
 *
 * 在 Worker 入口调用此函数设置消息处理。
 */
export function createDecoderWorker(): void {
  const decoder = new PixelVideoDecoder();
  const ctx = self as unknown as WorkerContext;

  self.onmessage = (event: MessageEvent<WorkerRequest>) => {
    const req = event.data;

    switch (req.type) {
      case 'configure':
        if (req.config) {
          decoder.configure(req.config);
          ctx.postMessage({ type: 'ready' });
        }
        break;

      case 'decode':
        if (req.chunk) {
          decoder.setFrameCallback((frame) => {
            ctx.postMessage({ type: 'frame', frame }, [frame]);
          });
          decoder.decode(
            req.chunk.timestamp,
            req.chunk.data,
            req.chunk.isKeyFrame,
          );
        }
        break;

      case 'seek':
        if (req.time !== undefined) {
          decoder.seek(req.time);
        }
        break;

      case 'destroy':
        decoder.destroy();
        ctx.close();
        break;
    }
  };
}
