// World-position SSAO. Fixed radius / strength / depth bias / kernel / seed.
// Screen-space approximation: unseen geometry cannot occlude; offscreen taps are open.
struct Globals { resolution:vec2f, time:f32, display_aspect:f32, view_projection:mat4x4f }
struct Params { options:vec4u, control:vec4u, fixed:vec4f, kernel:array<vec4f,32> }
@group(0) @binding(0) var<uniform> g:Globals;
@group(1) @binding(0) var<uniform> p:Params;
@group(2) @binding(0) var positions:texture_2d<f32>;
@group(2) @binding(1) var normals:texture_2d<f32>;
@group(2) @binding(2) var visibility:texture_2d<f32>;
struct Vertex { @builtin(position) @invariant clip:vec4f, @location(0) world:vec3f, @location(1) normal:vec3f, @location(2) color:vec3f }
@vertex fn vs_main(@location(0) world:vec3f,@location(1) normal:vec3f,@location(2) color:vec3f)->Vertex {var o:Vertex;o.clip=g.view_projection*vec4f(world,1.);o.world=world;o.normal=normal;o.color=color;return o;}
@vertex fn vs_full(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {let xy=array<vec2f,3>(vec2f(-1.,-1.),vec2f(3.,-1.),vec2f(-1.,3.));return vec4f(xy[i],0.,1.);}
struct Geometry { @location(0) position:vec4f,@location(1) normal:vec4f }
@fragment fn fs_geometry(v:Vertex)->Geometry {var o:Geometry;o.position=vec4f(v.world,1.);o.normal=vec4f(normalize(v.normal),1.);return o;}
fn coord(uv:vec2f)->vec2i {return clamp(vec2i(uv*vec2f(textureDimensions(positions))),vec2i(0),vec2i(textureDimensions(positions))-vec2i(1));}
fn hash(x:u32)->u32 {var v=x;v=(v^(v>>16u))*0x7feb352du;v=(v^(v>>15u))*0x846ca68bu;return v^(v>>16u);}
@fragment fn fs_ao(@builtin(position) pixel:vec4f)->@location(0) vec4f {
    let dims=max(vec2u(1),vec2u(g.resolution)*p.options.y/100u);
    let uv=pixel.xy/vec2f(dims);let xy=coord(uv);let position=textureLoad(positions,xy,0);
    if position.w==0. {return vec4f(1.);}
    let n=normalize(textureLoad(normals,xy,0).xyz);
    let axis=select(vec3f(0.,1.,0.),vec3f(1.,0.,0.),abs(n.y)>0.9);
    let t=normalize(cross(axis,n));let b=cross(n,t);
    let noise=hash(u32(xy.x)%4u+4u*(u32(xy.y)%4u)+p.control.y);
    let angle=f32(noise%1024u)*0.00613592315;let cs=cos(angle);let sn=sin(angle);
    var obscured=0.;
    for(var i=0u;i<p.options.x;i++) {
        let k=p.kernel[i].xyz;let rotated=vec2f(k.x*cs-k.y*sn,k.x*sn+k.y*cs);
        let sample_world=position.xyz+p.fixed.x*(t*rotated.x+b*rotated.y+n*k.z);
        let clip=g.view_projection*vec4f(sample_world,1.);
        if clip.w<=0. {continue;}
        let ndc=clip.xyz/clip.w;let sample_uv=vec2f(ndc.x*.5+.5,.5-ndc.y*.5);
        if any(sample_uv<vec2f(0.)) || any(sample_uv>=vec2f(1.)) || ndc.z<0. || ndc.z>1. {continue;}
        let hit=textureLoad(positions,coord(sample_uv),0);if hit.w==0. {continue;}
        let hit_clip=g.view_projection*vec4f(hit.xyz,1.);
        // Perspective clip.w is positive view depth. Bias is in world/view units.
        let distance=length(hit.xyz-position.xyz);
        let range=1.-smoothstep(p.fixed.x*.5,p.fixed.x*1.5,distance);
        obscured+=select(0.,range,hit_clip.w<clip.w-p.fixed.z);
    }
    let ao=clamp(1.-p.fixed.y*obscured/f32(p.options.x),0.,1.);return vec4f(ao,ao,ao,1.);
}
@fragment fn fs_blur(@builtin(position) pixel:vec4f)->@location(0) vec4f {
    let dims=vec2i(textureDimensions(visibility));let center=vec2i(pixel.xy);let uv=pixel.xy/vec2f(dims);let xy=coord(uv);
    let pos=textureLoad(positions,xy,0);if pos.w==0. {return vec4f(1.);}
    let n=normalize(textureLoad(normals,xy,0).xyz);let radius=i32(p.options.z);var sum=0.;var weights=0.;
    for(var y=-radius;y<=radius;y++){for(var x=-radius;x<=radius;x++){
        let q=center+vec2i(x,y);if any(q<vec2i(0))||any(q>=dims){continue;}
        let full=coord((vec2f(q)+.5)/vec2f(dims));let other=textureLoad(positions,full,0);if other.w==0.{continue;}
        let on=normalize(textureLoad(normals,full,0).xyz);
        let weight=exp(-length(pos.xyz-other.xyz)*20.)*pow(max(dot(n,on),0.),8.);
        sum+=weight*textureLoad(visibility,q,0).x;weights+=weight;
    }}
    let ao=sum/max(weights,0.000001);return vec4f(ao,ao,ao,1.);
}
// Same explicit bilinear reconstruction for every AO resolution, linear visibility.
fn read_ao(uv:vec2f)->f32 {
    if p.control.x==0u {return 1.;}
    let dims=vec2i(textureDimensions(visibility));let pos=uv*vec2f(dims)-.5;let lo=vec2i(floor(pos));let f=fract(pos);
    let a=textureLoad(visibility,clamp(lo,vec2i(0),dims-1),0).x;
    let b=textureLoad(visibility,clamp(lo+vec2i(1,0),vec2i(0),dims-1),0).x;
    let c=textureLoad(visibility,clamp(lo+vec2i(0,1),vec2i(0),dims-1),0).x;
    let d=textureLoad(visibility,clamp(lo+vec2i(1,1),vec2i(0),dims-1),0).x;
    return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
@fragment fn fs_main(v:Vertex)->@location(0) vec4f {
    let n=normalize(v.normal);let light=normalize(vec3f(-.6,1.,.5));let ao=read_ao(v.clip.xy/g.resolution);
    // AO modulates only the constant ambient term. Direct Lambert remains unchanged.
    let color=v.color*(.22*ao+.78*max(dot(n,light),0.));return vec4f(color,1.);
}
@fragment fn fs_debug(@builtin(position) pixel:vec4f)->@location(0) vec4f {let ao=read_ao(pixel.xy/g.resolution);return vec4f(ao,ao,ao,1.);}
