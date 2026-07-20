// PixelForge Graph Runtime - 单效果后处理着色器
//
// 与 effect_post.wgsl 的区别:
// - effect_post.wgsl: 在同一纹理上就地修改 (read_write), 遍历所有效果
// - graph_effect.wgsl: 从上游输入纹理读取, 写入新输出纹理, 只应用单个效果
//
// 物理绑定布局 (Group 0):
//   binding 0: uniform   Uniforms       全局元数据 (resolution / effectType)
//   binding 1: texture   inputTex       上游输入纹理 (只读)
//   binding 2: storage   outputTex      rgba8unorm 写入纹理
//   binding 3: storage   paramBuffer    vec4f 效果参数
//
// 效果类型常量 (与 regionCompiler EFFECT_TYPE_IDS 对齐):
//   0=BLUR   1=BLOOM   2=COLOR_SHIFT   3=VIGNETTE   4=MASK

struct Uniforms {
    resolution: vec2f,
    effectType: u32,
    _pad1: u32,
    _pad2: u32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var outputTex: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<storage, read> paramBuffer: array<vec4f>;

const EFFECT_BLUR: u32 = 0u;
const EFFECT_BLOOM: u32 = 1u;
const EFFECT_COLOR_SHIFT: u32 = 2u;
const EFFECT_VIGNETTE: u32 = 3u;
const EFFECT_MASK: u32 = 4u;

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

    var color = textureLoad(inputTex, pixelCoord);

    switch (uniforms.effectType) {
        case EFFECT_BLUR: {
            // 盒型模糊
            let radius = paramBuffer[0u].x;
            let pixelRadius = u32(clamp(radius * f32(texSize.x), 1.0, 8.0));
            var sum = vec4f(0.0);
            var count = 0.0;
            for (var dy = -i32(pixelRadius); dy <= i32(pixelRadius); dy++) {
                for (var dx = -i32(pixelRadius); dx <= i32(pixelRadius); dx++) {
                    let sampleCoord = clamp(pixelCoord + vec2i(dx, dy), vec2i(0), vec2i(texSize - 1));
                    sum += textureLoad(inputTex, sampleCoord);
                    count += 1.0;
                }
            }
            color = sum / max(count, 1.0);
        }
        case EFFECT_BLOOM: {
            // 泛光: 提取亮区并叠加
            let threshold = paramBuffer[0u].x;
            let intensity = paramBuffer[0u].y;
            let luminance = dot(color.rgb, vec3f(0.299, 0.587, 0.114));
            if (luminance > threshold) {
                let bloom = (luminance - threshold) * intensity;
                color = min(color + vec4f(vec3f(bloom), 0.0), vec4f(1.0));
            }
        }
        case EFFECT_COLOR_SHIFT: {
            // 色相偏移
            let shift = paramBuffer[0u].x;
            color.r = clamp(color.r + shift, 0.0, 1.0);
            color.g = clamp(color.g + shift * 0.5, 0.0, 1.0);
            color.b = clamp(color.b - shift * 0.3, 0.0, 1.0);
        }
        case EFFECT_VIGNETTE: {
            // 暗角
            let strength = paramBuffer[0u].x;
            let center = vec2f(0.5, 0.5);
            let dist = distance(coords, center);
            let vignette = 1.0 - smoothstep(0.3, 0.8, dist) * strength;
            color.rgb *= vignette;
        }
        case EFFECT_MASK: {
            // 遮罩: 根据参数裁剪圆形区域
            let maskCenter = vec2f(paramBuffer[0u].x, paramBuffer[0u].y);
            let maskRadius = paramBuffer[0u].z;
            let dist = distance(coords, maskCenter);
            if (dist > maskRadius) {
                color = vec4f(0.0, 0.0, 0.0, 1.0);
            }
        }
        default: {
            // 未知效果类型: 直接透传
        }
    }

    textureStore(outputTex, pixelCoord, color);
}
