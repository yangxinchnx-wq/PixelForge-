/**
 * PixelForge Media Video — FrameUploader（GPU 纹理上传）。
 *
 * 将解码后的 VideoFrame 上传到 GPU Texture。
 *
 * 链路：
 *   VideoFrame → copyExternalImageToTexture → GPUTexture → WebGPU Render
 *
 * 现在：视频进入 GPU。
 */

/** GPU 纹理上传参数。 */
export interface UploadOptions {
  /** GPU 设备 */
  device: GPUDevice;
  /** 要上传的 VideoFrame */
  frame: VideoFrame;
  /** 纹理宽度 */
  width: number;
  /** 纹理高度 */
  height: number;
}

/**
 * FrameUploader — 把 VideoFrame 上传到 GPU Texture。
 *
 * 创建纹理：
 *   device.createTexture({
 *     size: [width, height],
 *     format: "rgba8unorm",
 *     usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
 *   })
 *
 * 上传：
 *   device.queue.copyExternalImageToTexture(
 *     { source: frame },
 *     { texture: texture },
 *     size
 *   )
 */
export class FrameUploader {
  /** 创建一个 GPUTexture（用于接收视频帧）。 */
  createTexture(
    device: GPUDevice,
    width: number,
    height: number,
  ): GPUTexture {
    return device.createTexture({
      label: 'video-frame-texture',
      size: [width, height],
      format: 'rgba8unorm',
      usage:
        (typeof GPUTextureUsage !== 'undefined'
          ? GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
          : 0x0010 | 0x0008 | 0x0020),
    });
  }

  /**
   * 将 VideoFrame 上传到 GPUTexture。
   *
   * @param options 上传参数
   * @returns 创建的 GPUTexture
   */
  upload(options: UploadOptions): GPUTexture {
    const { device, frame, width, height } = options;

    const texture = this.createTexture(device, width, height);

    device.queue.copyExternalImageToTexture(
      { source: frame },
      { texture },
      [width, height],
    );

    return texture;
  }

  /**
   * 更新已有纹理的内容（不创建新纹理）。
   *
   * @param device  GPU 设备
   * @param texture 目标纹理
   * @param frame   视频帧
   */
  update(
    device: GPUDevice,
    texture: GPUTexture,
    frame: VideoFrame,
  ): void {
    const size: [number, number] = [
      texture.width,
      texture.height,
    ];

    device.queue.copyExternalImageToTexture(
      { source: frame },
      { texture },
      size,
    );
  }
}
