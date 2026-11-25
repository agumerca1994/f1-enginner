# The landing intro, rendered in Blender (EEVEE): a long lens on the inside kerb of a fast
# corner, a train of cars coming from far away and passing a few metres from the lens.
#
#   blender -b -P intro.py -- --assets <dir> --out <dir> [--w 1920 --h 1080] [--frames 1-372] [--test 200]
#
# <dir> holds car.glb (the part-named single-seater, not in git), tex/asphalt_*.jpg and
# tex/sky.hdr (CC0, Poly Haven: asphalt_track, belfast_open_field).
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
opt = {argv[i].lstrip("-"): argv[i + 1] for i in range(0, len(argv) - 1, 2)}
ASSETS = Path(opt["assets"])
OUT = Path(opt.get("out", "/tmp/intro"))
W, H = int(opt.get("w", 1920)), int(opt.get("h", 1080))
FPS = 60
SECONDS = 6.2
PORTRAIT = H > W

RC = 300.0  # corner radius
HEADING = float(opt.get("heading", math.pi / 2))  # turns the imported car to face along the track
IN, OUT_EDGE = RC - 7.5, RC + 7.5
SPEED = 66.0  # m/s

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
scene.render.resolution_x, scene.render.resolution_y = W, H
scene.render.fps = FPS
scene.frame_start, scene.frame_end = 1, int(SECONDS * FPS)
scene.render.use_motion_blur = True
scene.render.motion_blur_shutter = 0.5
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "Medium High Contrast"
ee = scene.eevee
ee.taa_render_samples = 48
ee.use_raytracing = True
ee.use_shadows = True


# --- world: an overcast sky -------------------------------------------------------------
world = bpy.data.worlds.new("sky")
scene.world = world
world.use_nodes = True
wn = world.node_tree.nodes
env = wn.new("ShaderNodeTexEnvironment")
env.image = bpy.data.images.load(str(ASSETS / "tex" / "sky.hdr"))
bg = wn["Background"]
bg.inputs["Strength"].default_value = 1.1
world.node_tree.links.new(env.outputs["Color"], bg.inputs["Color"])
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 3.0
sun.data.angle = math.radians(12)
sun.rotation_euler = (math.radians(55), 0, math.radians(-30))
scene.collection.objects.link(sun)


# --- materials ---------------------------------------------------------------------------
def principled(name, color, rough=0.5, metal=0.0, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Coat Weight"].default_value = coat
    b.inputs["Coat Roughness"].default_value = 0.08
    return m


def srgb(h):
    c = [((h >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple((v / 12.92) if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


def asphalt(prefix="asphalt", scale=0.25, rough_mul=0.75, tint=None):
    m = bpy.data.materials.new(prefix)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    coord = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (scale, scale, scale)
    nt.links.new(coord.outputs["Object"], mapping.inputs["Vector"])
    def tex(name, non_color=False):
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = bpy.data.images.load(str(ASSETS / "tex" / name))
        if non_color:
            t.image.colorspace_settings.name = "Non-Color"
        nt.links.new(mapping.outputs["Vector"], t.inputs["Vector"])
        return t
    diffuse = tex(f"{prefix}_Diffuse.jpg").outputs["Color"]
    if tint:
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        mix.inputs["B"].default_value = (*tint, 1)
        nt.links.new(diffuse, mix.inputs["A"])
        diffuse = mix.outputs["Result"]
    nt.links.new(diffuse, b.inputs["Base Color"])
    rough = tex(f"{prefix}_Rough.jpg", True)
    mul = nt.nodes.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    mul.inputs[1].default_value = rough_mul  # below 1: a damp surface with a little sheen
    nt.links.new(rough.outputs["Color"], mul.inputs[0])
    nt.links.new(mul.outputs[0], b.inputs["Roughness"])
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(tex(f"{prefix}_nor_gl.jpg", True).outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], b.inputs["Normal"])
    return m


# --- the corner ----------------------------------------------------------------------------
def band(name, r1, r2, a0, a1, z, segs, mat):
    verts, faces = [], []
    for i in range(segs + 1):
        a = a0 + (a1 - a0) * i / segs
        verts += [(r1 * math.cos(a), r1 * math.sin(a), z), (r2 * math.cos(a), r2 * math.sin(a), z)]
        if i:
            k = 2 * (i - 1)
            faces.append((k, k + 2, k + 3, k + 1))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return ob


A0, A1 = -1.2, 0.25
band("road", IN, OUT_EDGE, A0, A1, 0, 1200, asphalt())
line = principled("line", srgb(0xE6E6E6), 0.6)
band("line_in", IN + 0.1, IN + 0.35, A0, A1, 0.004, 1200, line)
band("line_out", OUT_EDGE - 0.35, OUT_EDGE - 0.1, A0, A1, 0.004, 1200, line)
red, white = principled("kerb_red", srgb(0xA81C12), 0.6), principled("kerb_white", srgb(0xCFCFCF), 0.6)
step = 1.5 / IN
i, a = 0, A0
while a < A1:
    band(f"kerb{i}", IN - 1.4, IN, a, a + step, 0.025, 1, white if i % 2 else red)
    i, a = i + 1, a + step
grass = asphalt("grass", 0.5, 1.0, tint=(0.35, 0.75, 0.25))
band("grass_in", IN - 60, IN - 1.4, A0, A1, -0.01, 300, grass)
band("runoff", OUT_EDGE, OUT_EDGE + 14, A0, A1, -0.005, 300, principled("runoff", srgb(0x6E6A63), 0.8))
band("grass_out", OUT_EDGE + 14, OUT_EDGE + 80, A0, A1, -0.01, 300, grass)


def wall(name, r, h, mat, a0=A0, a1=A1):
    bpy.ops.mesh.primitive_cylinder_add(vertices=1600, radius=r, depth=h, location=(0, 0, h / 2), end_fill_type="NOTHING")
    ob = bpy.context.object
    ob.name = name
    ob.data.materials.append(mat)
    return ob


wall("barrier", OUT_EDGE + 14, 1.0, principled("barrier", srgb(0x1F3E8C), 0.5))


# --- the cars -------------------------------------------------------------------------------
LIVERIES = [(0xD8301C, 0x15171B), (0xE9ECEF, 0xFF4B2B), (0x13606E, 0x3DDC97), (0x23272E, 0xFF4B2B)]
bpy.ops.import_scene.gltf(filepath=str(ASSETS / "car.glb"))
template = [o for o in bpy.context.selected_objects]
root = next(o for o in template if o.parent is None)

shared = {
    "carbon_fiber": principled("carbon", srgb(0x16171A), 0.35, 0.2, 0.6),
    "tier": principled("tyre", srgb(0x141416), 0.85),
    "chrome": principled("chrome", (0.8, 0.8, 0.8), 0.15, 1.0),
    "mirror": principled("mirror", (0.9, 0.9, 0.9), 0.02, 1.0),
    "glass": principled("glass", (0.02, 0.02, 0.02), 0.05, 0.0, 1.0),
}


ORIGINAL = {}
for o in template:
    if o.type == "MESH":
        ORIGINAL[o.name] = [sl.material.name.split(".")[0] if sl.material else "carbon_fiber" for sl in o.material_slots]


def paint(obj_tree, body, accent, source_names):
    mats = dict(shared)
    mats["chassis"] = principled(f"paint_{body:06x}", srgb(body), 0.3, 0.3, 1.0)
    mats["coler"] = principled(f"accent_{accent:06x}", srgb(accent), 0.3, 0.3, 1.0)
    for src, o in obj_tree:
        if o.type != "MESH":
            continue
        for slot, base in zip(o.material_slots, ORIGINAL.get(src, [])):
            slot.material = mats.get(base, shared["carbon_fiber"])


def duplicate(root):
    new = {}
    def copy(o, parent):
        c = o.copy()
        if o.data:
            c.data = o.data.copy()
        scene.collection.objects.link(c)
        c.parent = parent
        new[o.name] = c
        for ch in o.children:
            copy(ch, c)
        return c
    return copy(root, None), new


copies = [duplicate(root) for _ in LIVERIES[1:]]
copies.insert(0, (root, {o.name: o for o in template}))
cars = []
for n, ((body, accent), (top, objs)) in enumerate(zip(LIVERIES, copies)):
    tree = list(objs.values())
    paint(list(objs.items()), body, accent, None)
    wheels = []
    for o in tree:
        if o.type == "MESH" and o.parent and o.parent.name.startswith("wheel_"):
            wheels.append(o)
    # Each wheel part rolls about its own centre: put the origin there.
    for w in wheels:
        bpy.ops.object.select_all(action="DESELECT")
        w.select_set(True)
        bpy.context.view_layer.objects.active = w
        bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    top.rotation_mode = "XYZ"  # the glTF importer leaves quaternions, which rotation_euler would not drive
    for w in wheels:
        w.rotation_mode = "XYZ"
    cars.append({"root": top, "wheels": wheels, "a0": -0.86 - n * 0.072, "r": [RC + 2.6, RC + 1.2, RC + 3.4, RC - 4.3][n], "phase": n * 1.7, "last": n == len(LIVERIES) - 1})


# --- camera: locked off on the inside kerb, a long lens up the corner ------------------------
cam_data = bpy.data.cameras.new("cam")
cam_data.lens = 135 if PORTRAIT else 200
cam_data.sensor_width = 36
cam_data.dof.use_dof = True
cam_data.dof.aperture_fstop = 8.0
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
CAM = Vector(((IN - 0.9), 0.0, 0.55))
LOOK = Vector(((RC - 1.0) * math.cos(-0.3), (RC - 1.0) * math.sin(-0.3), 0.15))
focus = bpy.data.objects.new("focus", None)
scene.collection.objects.link(focus)
cam_data.dof.focus_object = focus


focus_at = None


def place(frame):
    t = (frame - 1) / FPS
    lead, shake = None, 0.0
    for c in cars:
        a = c["a0"] + SPEED / RC * t
        r = c["r"] + 0.35 * math.sin(t * 1.3 + c["phase"])
        c["root"].location = (r * math.cos(a), r * math.sin(a), 0)
        c["root"].rotation_euler = (0, 0, a + HEADING + 0.015)
        c["root"].keyframe_insert("location", frame=frame)
        c["root"].keyframe_insert("rotation_euler", frame=frame)
        for w in c["wheels"]:
            w.rotation_euler = (0, t * SPEED / 0.36, 0)  # rolling forward about the axle (local y)
            w.keyframe_insert("rotation_euler", frame=frame)
        d = abs(a) * RC
        shake = max(shake, math.exp(-d / 5) * (1.0 if c["last"] else 0.3))
        if a < -0.03 and (lead is None or a > lead[0]):
            lead = (a, Vector(c["root"].location))
    # Focus pulls on the leading car still in front of the lens.
    # It lets go of each car ~9 m before it passes and eases back, so the frame never goes soft.
    global focus_at
    want = lead[1] + Vector((0, 0, 0.6)) if lead else LOOK
    focus_at = want if focus_at is None else focus_at.lerp(want, 0.12)
    focus.location = focus_at
    focus.keyframe_insert("location", frame=frame)
    off = Vector((0.0, math.sin(t * 67) * 0.02 * shake, (math.sin(t * 53) * 0.6 + math.sin(t * 91) * 0.4) * 0.025 * shake))
    cam.location = CAM + off
    direction = (LOOK - CAM).normalized()
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    cam.rotation_euler.rotate_axis("Z", (math.sin(t * 71) * 0.6 + math.sin(t * 43) * 0.4) * 0.01 * shake)
    cam.keyframe_insert("location", frame=frame)
    cam.keyframe_insert("rotation_euler", frame=frame)


for f in range(scene.frame_start, scene.frame_end + 1):
    place(f)

OUT.mkdir(parents=True, exist_ok=True)
scene.render.image_settings.file_format = "JPEG"
scene.render.image_settings.quality = 92
if "test" in opt:
    scene.frame_set(int(opt["test"]))
    scene.render.filepath = str(OUT / f"test_{opt['test']}.jpg")
    bpy.ops.render.render(write_still=True)
else:
    lo, hi = map(int, opt.get("frames", f"{scene.frame_start}-{scene.frame_end}").split("-"))
    scene.frame_start, scene.frame_end = lo, hi
    scene.render.filepath = str(OUT / "f####")
    bpy.ops.render.render(animation=True)
