// Experiment 01: analytic sphere, Lambert diffuse + Blinn-Phong highlight.
// Edit roughness, base color or lighting; invalid reloads retain the last pipeline.
struct Globals { resolution: vec2f, time: f32, display_aspect: f32 }
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
    // Resolution is internal pixels; display aspect is fixed even at odd rounded sizes.
    let aspect = select(globals.resolution.x / globals.resolution.y,
                        globals.display_aspect, globals.display_aspect > 0.);
    let uv = (in.uv * 2. - 1.) * vec2f(aspect, 1.);
    let radius = .68;
    let r2 = dot(uv,uv) / (radius * radius);
    let background = mix(vec3f(.012,.019,.033), vec3f(.028,.047,.07), in.uv.y);
    if r2 > 1. { return vec4f(background, 1.); }
    let normal = normalize(vec3f(uv / radius, sqrt(max(0.,1.-r2))));
    let light = normalize(vec3f(cos(globals.time * .45) * .65, .75, 1.2));
    let half_vector = normalize(light + vec3f(0.,0.,1.));
    let base_color = vec3f(.12,.55,.47);
    let roughness = .35;
    let diffuse = max(dot(normal,light),0.);
    let specular = pow(max(dot(normal,half_vector),0.), mix(128.,4.,roughness));
    let color = base_color * (.08 + .92 * diffuse) + vec3f(specular * .65);
    return vec4f(color,1.);
}
