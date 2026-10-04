// WebGPU RH clip depth 0..1. Nearest comparison-depth PCF; no hidden bilinear taps.
struct Globals { resolution: vec2f, time: f32, display_aspect: f32, view_projection: mat4x4f };
struct Light { view_projection: mat4x4f, direction: vec4f, bias: vec4f, options: vec4u };
@group(0) @binding(0) var<uniform> globals: Globals;
@group(1) @binding(0) var<uniform> light: Light;
@group(2) @binding(0) var shadow_map: texture_depth_2d;
@group(2) @binding(1) var nearest_depth: sampler_comparison;
struct Vertex { @location(0) position: vec3f, @location(1) normal: vec3f, @location(2) color: vec3f };
struct Varying { @builtin(position) position: vec4f, @location(0) world: vec3f, @location(1) normal: vec3f, @location(2) color: vec3f };
@vertex fn vs_main(v: Vertex) -> Varying {
    var o: Varying; o.position = globals.view_projection * vec4f(v.position,1.0);
    o.world=v.position; o.normal=v.normal; o.color=v.color; return o;
}
@vertex fn vs_depth(v: Vertex) -> @builtin(position) vec4f { return light.view_projection * vec4f(v.position,1.0); }
fn visibility(world: vec3f, normal: vec3f) -> f32 {
    if light.options.w == 0u { return 1.0; }
    let clip = light.view_projection * vec4f(world,1.0);
    let ndc = clip.xyz / clip.w;
    let uv = vec2f(ndc.x*0.5+0.5, 0.5-ndc.y*0.5);
    if any(uv < vec2f(0.0)) || any(uv >= vec2f(1.0)) || ndc.z<0.0 || ndc.z>1.0 { return 1.0; }
    // Bias is applied only by the shadow pass DepthBiasState, never in receiver space.
    let reference = ndc.z;
    let size = i32(light.options.x);
    let center = vec2i(floor(uv*f32(size)));
    let radius = i32(light.options.y/2u);
    var visible = 0.0;
    for(var y = -radius; y <= radius; y++) {
        for(var x = -radius; x <= radius; x++) {
            let p = center + vec2i(x,y);
            if any(p<vec2i(0)) || any(p>=vec2i(size)) { visible += 1.0; }
            else { visible += textureSampleCompareLevel(shadow_map,nearest_depth,(vec2f(p)+vec2f(0.5))/f32(size),reference); }
        }
    }
    return visible/f32(light.options.y*light.options.y);
}
@fragment fn fs_main(v: Varying) -> @location(0) vec4f {
    let vis = visibility(v.world,v.normal);
    if light.options.z == 2u { return vec4f(vec3f(vis),1.0); }
    let diffuse=max(dot(normalize(v.normal),light.direction.xyz),0.0);
    return vec4f(v.color*(0.16+0.84*diffuse*vis),1.0);
}
@vertex fn vs_debug(@builtin(vertex_index) i:u32) -> @builtin(position) vec4f {
    let p=array<vec2f,3>(vec2f(-1.0,-1.0),vec2f(3.0,-1.0),vec2f(-1.0,3.0));
    return vec4f(p[i],0.0,1.0);
}
@fragment fn fs_debug(@builtin(position) p:vec4f) -> @location(0) vec4f {
    let uv=p.xy/globals.resolution;
    let at=clamp(vec2i(uv*f32(light.options.x)),vec2i(0),vec2i(i32(light.options.x)-1));
    let center=(vec2f(at)+vec2f(0.5))/f32(light.options.x);
    // Reconstruct stored depth using portable nearest comparisons, including raster bias.
    // Sixteen fixed steps give normalized depth quantization <= 1/65536.
    var low=0.0; var high=1.0;
    for(var i=0u;i<16u;i++) {
        let mid=(low+high)*0.5;
        let lit=textureSampleCompareLevel(shadow_map,nearest_depth,center,mid);
        if lit>0.5 {low=mid;} else {high=mid;}
    }
    return vec4f(vec3f((low+high)*0.5),1.0);
}
