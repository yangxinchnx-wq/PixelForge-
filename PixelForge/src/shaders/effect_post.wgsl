// PixelForge Phase B - 效果后处理着色器
//
// 在图层求值完成后，对输出纹理应用效果。
// 使用 read_write 存储纹理，在同一纹理上就地修改。
//
// 物理绑定布局（Group 0）：
//   binding 0: uniform     Uniforms           全局元数据
//   binding 1: storage     outputTex          rgba8unorm 读写纹理
//   binding 2: storage     effectBuffer       vec4f 效果参数数组
//   binding 3: storage     effectDescBuffer   u32 效果描述符数组
//
// 效果描述符布局：
//   effectDescBuffer[0] = effectCount
//   For each effect i:
//     effectDescBuffer[1 + 2*i] = effectType(8) | reserved(8) | paramIndex(16)
//     effectDescBuffer[2 + 2*i] = reserved(32)
//
// 效果类型常量：
//   0=BLUR   1=BLOOM   2=COLOR_SHIFT   3=VIGNETTE   4=MASK

struct Uniforms {
    resolution: vec2f,
    seed: u32,
    layerCount: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var outputTex: texture_storage_2d<rgba8unorm, read_write>;
@group(0) @binding(2) var<storage, read> effectBuffer: array<vec4f>;
@group(0) @binding(3) var<storage, read> effectDescBuffer: array<u32>;

const EFFECT_BLUR: u32 = 0u;
const EFFECT_BLOOM: u32 = 1u;
const EFFECT_COLOR_SHIFT: u32 = 2u;
const EFFECT_VIGNETTE: u32 = 3u;
const EFFECT_MASK: u32 = 4u;

// 简单伪随机
fn hash2(p: vec2f) -> f32 {
    return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3u) {
    let texSize = textureDimensions(outputTex);

    if (gid.x >= texSize.x || gid.y >= texSize.y) {
        return;
    }

    let pixelCoord = vec2i(gid.xy);
    let coords = vec2f(
        f32(gid.x) / f32(texSize.x),
        f32(gid.y) / f32(texSize.y)
    );

    var color = textureLoad(outputTex, pixelCoord);

    let effectCount = effectDescBuffer[0u];

    for (var i = 0u; i < effectCount; i++) {
        let packedDesc = effectDescBuffer[1u + 2u * i];
        let effectType = (packedDesc >> 24u) & 0xFFu;
        let paramIndex = packedDesc & 0xFFFFu;

        switch (effectType) {
            case EFFECT_BLUR: {
                // 简单盒型模糊
                let radius = effectBuffer[paramIndex].x;
                let pixelRadius = u32(clamp(radius * f32(texSize.x), 1.0, 8.0));
                var sum = vec4f(0.0);
                var count = 0.0;
                for (var dy = -i32(pixelRadius); dy <= i32(pixelRadius); dy++) {
                    for (var dx = -i32(pixelRadius); dx <= i32(pixelRadius); dx++) {
                        let sampleCoord = clamp(pixelCoord + vec2i(dx, dy), vec2i(0), vec2i(texSize - 1));
                        sum += textureLoad(outputTex, sampleCoord);
                        count += 1.0;
                    }
                }
                color = sum / max(count, 1.0);
            }
            case EFFECT_BLOOM: {
                // 简单泛光：提取亮区并叠加
                let threshold = effectBuffer[paramIndex].x;
                let intensity = effectBuffer[paramIndex].y;
                let luminance = dot(color.rgb, vec3f(0.299, 0.587, 0.114));
                if (luminance > threshold) {
                    let bloom = (luminance - threshold) * intensity;
                    color = min(color + vec4f(vec3f(bloom), 0.0), vec4f(1.0));
                }
            }
            case EFFECT_COLOR_SHIFT: {
                // 色相偏移
                let shift = effectBuffer[paramIndex].x;
                let r = color.r;
                let g = color.g;
                let b = color.b;
                color.r = clamp(r + shift, 0.0, 1.0);
                color.g = clamp(g + shift * 0.5, 0.0, 1.0);
                color.b = clamp(b - shift * 0.3, 0.0, 1.0);
            }
            case EFFECT_VIGNETTE: {
                // 暗角
                let strength = effectBuffer[paramIndex].x;
                let center = vec2f(0.5, 0.5);
                let dist = distance(coords, center);
                let vignette = 1.0 - smoothstep(0.3, 0.8, dist) * strength;
                color.rgb *= vignette;
            }
            case EFFECT_MASK: {
                // 遮罩：根据参数裁剪圆形区域
                let maskCenter = vec2f(effectBuffer[paramIndex].x, effectBuffer[paramIndex].y);
                let maskRadius = effectBuffer[paramIndex].z;
                let dist = distance(coords, maskCenter);
                if (dist > maskRadius) {
                    color = vec4f(0.0, 0.0, 0.0, 1.0);
                }
            }
            default: {
                // 未知效果类型：跳过
            }
        }
    }

    textureStore(outputTex, pixelCoord, color);
}
