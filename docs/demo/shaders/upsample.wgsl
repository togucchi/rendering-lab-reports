// sRGB texture sampling decodes to linear light before bilinear filtering.
// The sRGB output attachment encodes once; do not add gamma conversion here.
@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var image_sampler: sampler;
struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};
@vertex fn vs_main(@builtin(vertex_index) index: u32) -> VertexOutput {
    let p = array<vec2f, 3>(vec2f(-1.0,-1.0), vec2f(3.0,-1.0), vec2f(-1.0,3.0));
    var out: VertexOutput;
    out.position = vec4f(p[index],0.0,1.0);
    out.uv = p[index] * vec2f(0.5,-0.5) + vec2f(0.5);
    return out;
}
@fragment fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    return textureSample(image, image_sampler, in.uv);
}
