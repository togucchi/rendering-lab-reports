// Shared interface: one 16-byte uniform; linear RGB output to sRGB surface.
struct Globals { resolution: vec2f, time: f32, _pad: f32 }
@group(0) @binding(0) var<uniform> globals: Globals;
struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn vs_main(@builtin(vertex_index) index: u32) -> Vertex {
    let p = array(vec2f(-1.,-1.), vec2f(3.,-1.), vec2f(-1.,3.));
    var out: Vertex;
    out.position = vec4f(p[index], 0., 1.);
    out.uv = p[index] * .5 + .5;
    return out;
}
@fragment fn fs_main(in: Vertex) -> @location(0) vec4f {
    let wave = .5 + .5 * sin(globals.time);
    return vec4f(in.uv, wave * .45 + .08, 1.);
}
