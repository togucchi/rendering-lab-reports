// Curated glTF 2.0 opaque metallic-roughness baseline: no IBL, shadows or transmission.
// Base-color sampler decodes sRGB; normal/ORM are linear. Output encodes only via sRGB attachment.
struct Globals { resolution: vec2f, time: f32, display_aspect: f32, view_projection: mat4x4f }
@group(0) @binding(0) var<uniform> globals: Globals;
struct View { eye: vec4f, light: vec4f, radiance: vec4f, settings: vec4u }
@group(1) @binding(0) var<uniform> view: View;
struct Material { base_color: vec4f, factors: vec4f }
@group(2) @binding(0) var<uniform> material: Material;
@group(2) @binding(1) var tex_sampler: sampler;
@group(2) @binding(2) var base_tex: texture_2d<f32>;
@group(2) @binding(3) var normal_tex: texture_2d<f32>;
@group(2) @binding(4) var orm_tex: texture_2d<f32>;
struct VertexIn { @location(0) position: vec3f, @location(1) normal: vec3f, @location(2) tangent: vec4f, @location(3) uv: vec2f }
struct VertexOut { @builtin(position) position: vec4f, @location(0) world: vec3f, @location(1) normal: vec3f, @location(2) tangent: vec4f, @location(3) uv: vec2f }
@vertex fn vs_main(v: VertexIn) -> VertexOut {
 var o: VertexOut; o.position = globals.view_projection * vec4f(v.position,1.0); o.world=v.position;
 o.normal=v.normal; o.tangent=v.tangent; o.uv=v.uv; return o;
}
fn fresnel_schlick(vh:f32, f0:vec3f)->vec3f { return f0+(vec3f(1.0)-f0)*pow(1.0-vh,5.0); }
fn distribution_ggx(nh:f32,alpha:f32)->f32 {
 let a2=alpha*alpha; let d=nh*nh*(a2-1.0)+1.0; return a2/(3.141592653589793*d*d);
}
// Height-correlated Smith visibility, includes 1/(4 N.L N.V).
fn visibility_smith(nl:f32,nv:f32,alpha:f32)->f32 {
 let a2=alpha*alpha;
 let gv=nl*sqrt(nv*nv*(1.0-a2)+a2); let gl=nv*sqrt(nl*nl*(1.0-a2)+a2);
 return 0.5/max(gv+gl,0.000001);
}
fn material_channels(orm:vec3f,metal:f32,rough:f32)->vec2f {return vec2f(metal*orm.b,rough*orm.g);}
fn mapped_normal(geometric_n:vec3f,source_tangent:vec4f,sample_value:vec3f,scale:f32)->vec3f {
 let tangent=normalize(source_tangent.xyz-geometric_n*dot(geometric_n,source_tangent.xyz));
 let bitangent=cross(geometric_n,tangent)*source_tangent.w;
 let tnormal=normalize((sample_value*2.0-1.0)*vec3f(scale,scale,1.0));
 return normalize(mat3x3f(tangent,bitangent,geometric_n)*tnormal);
}
fn facing_normal(n:vec3f,front:bool)->vec3f {return select(-n,n,front);}
@fragment fn fs_main(v:VertexOut,@builtin(front_facing) front:bool)->@location(0) vec4f {
 // Derivatives are evaluated unconditionally; settings are per-draw uniforms.
 let base_sample=textureSample(base_tex,tex_sampler,v.uv);
 let normal_sample=textureSample(normal_tex,tex_sampler,v.uv).xyz;
 let orm=textureSample(orm_tex,tex_sampler,v.uv).rgb;
 var base=material.base_color.rgb;
 if ((view.settings.y & 1u)!=0u) { base*=base_sample.rgb; }
 var metal=material.factors.x; var rough=material.factors.y;
 if ((view.settings.y & 4u)!=0u) { let mr=material_channels(orm,metal,rough); metal=mr.x; rough=mr.y; }
 metal=clamp(metal,0.0,1.0); rough=clamp(rough,0.0,1.0);
 let geometric_n=normalize(v.normal);
 var n=geometric_n;
 if ((view.settings.y & 2u)!=0u && material.factors.w>0.5) {
  n=mapped_normal(geometric_n,v.tangent,normal_sample,material.factors.z);
 }
 n=facing_normal(n,front);
 if (view.settings.x==1u) { return vec4f(base,1.0); }
 if (view.settings.x==2u) { return vec4f(n*0.5+0.5,1.0); }
 if (view.settings.x==3u) { return vec4f(vec3f(metal),1.0); }
 if (view.settings.x==4u) { return vec4f(vec3f(rough),1.0); }
 let l=normalize(view.light.xyz); let to_eye=normalize(view.eye.xyz-v.world); let h=normalize(l+to_eye);
 let nl=max(dot(n,l),0.0); let nv=max(dot(n,to_eye),0.000001);
 let nh=max(dot(n,h),0.0); let vh=max(dot(to_eye,h),0.0);
 let alpha=max(rough*rough,0.0016); let f0=mix(vec3f(0.04),base,metal); let f=fresnel_schlick(vh,f0);
 let spec=distribution_ggx(nh,alpha)*visibility_smith(nl,nv,alpha)*f;
 let diffuse=(vec3f(1.0)-f)*(1.0-metal)*base/3.141592653589793;
 // ORM.r is occlusion, intentionally unused for direct lighting.
 let linear=(diffuse+spec)*view.radiance.rgb*nl*view.radiance.w;
 return vec4f(linear/(vec3f(1.0)+linear),1.0); // Reinhard, exposure radiance.w=1
}
