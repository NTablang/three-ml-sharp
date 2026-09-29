# pip install torch transformers pillow numpy plyfile
import sys
from transformers import pipeline
from PIL import Image
import numpy as np
from plyfile import PlyData, PlyElement

in_path = sys.argv[1] if len(sys.argv) > 1 else "input.jpg"
out_path = sys.argv[2] if len(sys.argv) > 2 else "out.ply"
max_dim = int(sys.argv[3]) if len(sys.argv) > 3 else 512

img = Image.open(in_path).convert("RGB")
if max(img.size) > max_dim:
    img.thumbnail((max_dim, max_dim), Image.LANCZOS)

depth = pipeline("depth-estimation", model="depth-anything/Depth-Anything-V2-Small-hf")(img)["depth"]
d = np.array(depth, dtype=np.float32)
rgb = np.array(img, dtype=np.float32) / 255.0
h, w = d.shape
xs, ys = np.meshgrid(np.arange(w), np.arange(h))
xyz = np.stack([(xs - w / 2) / w, -(ys - h / 2) / w, -d / 255.0], -1).reshape(-1, 3)
rgb = rgb.reshape(-1, 3)

SH_C0 = 0.28209479177387814
sh = (rgb - 0.5) / SH_C0

verts = np.empty(
    len(xyz),
    dtype=[
        ("x", "f4"), ("y", "f4"), ("z", "f4"),
        ("f_dc_0", "f4"), ("f_dc_1", "f4"), ("f_dc_2", "f4"),
    ],
)
verts["x"], verts["y"], verts["z"] = xyz[:, 0], xyz[:, 1], xyz[:, 2]
verts["f_dc_0"], verts["f_dc_1"], verts["f_dc_2"] = sh[:, 0], sh[:, 1], sh[:, 2]
PlyData([PlyElement.describe(verts, "vertex")]).write(out_path)
print(f"wrote {out_path}: {len(verts)} points")
