// Experiment 04: same cube and immutable instance data; individual draws versus batching.
// Linear vertex colors + ambient fill; no textures, glTF, PBR, or shadow maps.
// First 16 bytes match the fullscreen experiments. The matrix is column-major.
struct Globals {
    resolution: vec2f,
    time: f32,
    _pad: f32,
    view_projection: mat4x4f,
}
@group(0) @binding(0) var<uniform> globals: Globals;

struct VertexInput {
    @location(0) position: vec3f,
    @location(1) normal: vec3f,
    @location(2) color: vec3f,
    @location(3) translation: vec4f,
    @location(4) scale: vec4f,
    @location(5) instance_color: vec4f,
}
struct VertexOutput {
    @invariant @builtin(position) position: vec4f,
    @location(0) world_position: vec3f,
    @location(1) normal: vec3f,
    @location(2) color: vec3f,
}
@vertex fn vs_main(in: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    let world = in.position * in.scale.xyz + in.translation.xyz;
    out.position = globals.view_projection * vec4f(world, 1.);
    out.world_position = world;
    out.normal = normalize(in.normal / in.scale.xyz);
    out.color = in.color * in.instance_color.rgb;
    return out;
}
@fragment fn fs_main(in: VertexOutput) -> @location(0) vec4f {
    let normal = normalize(in.normal);
    // Pausing time freezes the lighting exactly for A/B comparisons.
    let light = normalize(vec3f(cos(globals.time * .22) * .75, 1.25, .7));
    let diffuse = max(dot(normal, light), 0.);
    var base_color = in.color;
    if in.world_position.y < .01 && normal.y > .99 {
        let tile = floor(in.world_position.x) + floor(in.world_position.z);
        let checker = tile - 2. * floor(tile * .5);
        base_color *= .90 + .10 * checker;
    }
    let ambient = .19;
    return vec4f(base_color * (ambient + .81 * diffuse), 1.);
}
