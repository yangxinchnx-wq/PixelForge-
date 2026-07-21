// PixelForge Compositor — Blend Shader
//
// 根据 blendMode 选择混合公式：
//   Normal:   dst = mix(dst, src, alpha)
//   Multiply: result = A * B
//   Screen:   result = 1 - (1-A) * (1-B)
//   Overlay:  mix(2*A*B, 1-2*(1-A)*(1-B), step(0.5, A))
//   Add:      result = min(A + B, 1)
//   Darken:   result = min(A, B)
//   Lighten:  result = max(A, B)

const BLEND_NORMAL: u32 = 0u;
const BLEND_MULTIPLY: u32 = 1u;
const BLEND_SCREEN: u32 = 2u;
const BLEND_OVERLAY: u32 = 3u;
const BLEND_ADD: u32 = 4u;
const BLEND_DARKEN: u32 = 5u;
const BLEND_LIGHTEN: u32 = 6u;

fn blend_colors(dst: vec4<f32>, src: vec4<f32>, mode: u32) -> vec4<f32> {
    let alpha = src.a;
    var result: vec3<f32>;

    switch (mode) {
        case BLEND_NORMAL: {
            result = mix(dst.rgb, src.rgb, alpha);
        }
        case BLEND_MULTIPLY: {
            result = dst.rgb * src.rgb;
        }
        case BLEND_SCREEN: {
            result = 1.0 - (1.0 - dst.rgb) * (1.0 - src.rgb);
        }
        case BLEND_OVERLAY: {
            let overlay = mix(
                2.0 * dst.rgb * src.rgb,
                1.0 - 2.0 * (1.0 - dst.rgb) * (1.0 - src.rgb),
                step(0.5, dst.rgb)
            );
            result = overlay;
        }
        case BLEND_ADD: {
            result = min(dst.rgb + src.rgb, vec3<f32>(1.0));
        }
        case BLEND_DARKEN: {
            result = min(dst.rgb, src.rgb);
        }
        case BLEND_LIGHTEN: {
            result = max(dst.rgb, src.rgb);
        }
        default: {
            result = mix(dst.rgb, src.rgb, alpha);
        }
    }

    return vec4<f32>(mix(dst.rgb, result, alpha), mix(dst.a, 1.0, alpha));
}
