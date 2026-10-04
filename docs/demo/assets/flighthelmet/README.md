# FlightHelmet512px

This is a prepared derivative, not the original high-resolution FlightHelmet.
The source lock and preparation program live in scripts/. Original source files
are only held in a non-publishing cache outside this repository. No network or
third-party CDN is needed when viewing the prepared local GLB.

## Rebuild and verify

```sh
python3 -m pip install -r scripts/flighthelmet-requirements.txt
python3 scripts/prepare-flighthelmet.py --fetch
python3 scripts/prepare-flighthelmet.py --verify
python3 -m unittest discover -s scripts -p 'test_flighthelmet*.py'
```

The default source cache is the system temporary directory plus the source
commit; --cache-dir can select another location outside the checkout. Existing
cached files are checked against the source lock before use. --fetch only reads
the official pinned source URLs. --verify requires no network or original files.
Python, NumPy, Pillow, zlib and script/lock hashes are recorded in manifest.json.
Byte-for-byte reproduction uses those recorded versions; other zlib builds can
produce different compressed PNG bytes despite equivalent decoded samples.

## Semantic resize and mip contract

All 15 source PNGs are reduced to 512x512 with equal-area box filtering. The
source normal/ORM/base-color slots determine texture meaning. For base color,
decode RGB with the standard piecewise sRGB transfer function, average in linear
light and encode back to sRGB. Alpha is averaged separately in linear space.
For normals, decode XYZ from UNORM [0,1] into [-1,1], average vectors, normalize
to unit length (zero-length fallback +Z), then encode to UNORM. Do not invert Y.
ORM channels are averaged directly: R occlusion, G perceptual roughness,
B metallic. Averaging perceptual roughness deliberately smooths small details;
there is no variance-aware roughness compensation or texture compression.

The GLB stores only PNG level 0. At upload, create ten RGBA8 levels per image,
512,256,128,64,32,16,8,4,2,1. Each level must apply the same semantic filter to
the preceding quantized RGBA8 level, with round-to-nearest (floor(x*255+0.5)).
The reference uses float64, horizontal then vertical area averages. Per-level
decoded RGBA8 SHA-256 hashes in manifest.json enable exact CPU validation;
float32 runtime implementations can accumulate small quantization differences
across the chain (up to 2/255 observed for the native Rust helper). These are
preparation-reference hashes, not measured runtime/GPU-upload hashes. Test the
runtime against this reference rather than advertise it as byte-identical.
Base-color GPU format is Rgba8UnormSrgb; normals/ORM are Rgba8Unorm. The original
sampler is LINEAR/LINEAR_MIPMAP_LINEAR with REPEAT defaults. Use trilinear
filtering. Normal-map samples are renormalized again by the material shader.

Fifteen shared images, including the Hose/RubberWood material sharing, consume
20,971,500 bytes for all RGBA8 levels. This is 20 bytes below the 20 MiB asset
texture budget. Up to four 1x1 RGBA8 fallback textures fit (16 bytes); do not
allocate duplicate per-material or per-A/B image copies. This budget excludes
geometry, render targets, depth and driver-specific allocation overhead.
Transfer/package and texture budgets are measured and checked by the script.

KHR_materials_transmission remains optional and intact in the GLB. The renderer
must visibly warn that transmission is unsupported rather than silently imply
the lens matches the full source appearance. See CREDITS.md and manifest.json.
