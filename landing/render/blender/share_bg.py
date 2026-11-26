# Backgrounds for the shareable session card: one car up close, the camera panning with it,
# so the car is sharp and the track behind streaks. Same corner, materials and car as the intro.
#
#   blender -b -P share_bg.py -- --assets <dir> --out <dir> --shot paneo|frente|baja [--w 1080 --h 1920]
#
# <dir> is the intro's: car.glb (not in git) and tex/ (CC0, Poly Haven).
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
opt = {argv[i].lstrip("-"): argv[i + 1] for i in range(0, len(argv) - 1, 2)}
ASSETS = Path(opt["assets"])
OUT = Path(opt.get("out", "/tmp/share"))
SHOT = opt.get("shot", "paneo")
W, H = int(opt.get("w", 1080)), int(opt.get("h", 1920))
FPS = 60
RC = 300.0
IN, OUT_EDGE = RC - 7.5, RC + 7.5
SPEED = 72.0
HEADING = math.pi / 2

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
scene.render.resolution_x, scene.render.resolution_y = W, H
scene.render.fps = FPS
scene.render.use_motion_blur = True
scene.render.motion_blur_shutter = 2.5  # a slow shutter: the panning streaks
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Punchy"
ee = scene.eevee
ee.taa_render_samples = 96
ee.use_raytracing = True
ee.use_shadows = True
if hasattr(ee, "motion_blur_steps"):
    ee.motion_blur_steps = 8

world = bpy.data.worlds.new("sky")
scene.world = world
world.use_nodes = True
wn = world.node_tree.nodes
env = wn.new("ShaderNodeTexEnvironment")
env.image = bpy.data.images.load(str(ASSETS / "tex" / "sky.hdr"))
bg = wn["Background"]
bg.inputs["Strength"].default_value = 0.9 if SHOT != "baja" else 0.3
world.node_tree.links.new(env.outputs["Color"], bg.inputs["Color"])
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 4.0 if SHOT != "baja" else 7.0
sun.data.angle = math.radians(4)
sun.data.color = (1, 1, 1) if SHOT != "baja" else (1.0, 0.62, 0.36)  # "baja": low evening sun
sun.rotation_euler = (math.radians(50 if SHOT != "baja" else 82), 0, math.radians(-40 if SHOT != "baja" else 120))
scene.collection.objects.link(sun)


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
    mul.inputs[1].default_value = rough_mul
    nt.links.new(rough.outputs["Color"], mul.inputs[0])
    nt.links.new(mul.outputs[0], b.inputs["Roughness"])
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(tex(f"{prefix}_nor_gl.jpg", True).outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], b.inputs["Normal"])
    return m


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


A0, A1 = -1.2, 0.6
band("road", IN, OUT_EDGE, A0, A1, 0, 2400, asphalt())
line = principled("line", srgb(0xE6E6E6), 0.6)
band("line_in", IN + 0.1, IN + 0.35, A0, A1, 0.004, 2400, line)
band("line_out", OUT_EDGE - 0.35, OUT_EDGE - 0.1, A0, A1, 0.004, 2400, line)
red, white = principled("kerb_red", srgb(0xA81C12), 0.6), principled("kerb_white", srgb(0xCFCFCF), 0.6)
step = 1.5 / IN
i, a = 0, A0
while a < A1:
    band(f"kerb{i}", IN - 1.4, IN, a, a + step, 0.025, 1, white if i % 2 else red)
    band(f"kerbo{i}", OUT_EDGE, OUT_EDGE + 1.2, a, a + step, 0.02, 1, white if i % 2 else red)
    i, a = i + 1, a + step
grass = asphalt("grass", 0.5, 1.0, tint=(0.35, 0.75, 0.25))
band("grass_in", IN - 60, IN - 1.4, A0, A1, -0.01, 400, grass)
band("runoff", OUT_EDGE + 1.2, OUT_EDGE + 14, A0, A1, -0.005, 400, principled("runoff", srgb(0x6E6A63), 0.8))
band("grass_out", OUT_EDGE + 14, OUT_EDGE + 80, A0, A1, -0.01, 400, grass)
bpy.ops.mesh.primitive_cylinder_add(vertices=2400, radius=OUT_EDGE + 14, depth=1.0, location=(0, 0, 0.5), end_fill_type="NOTHING")
bpy.context.object.data.materials.append(principled("barrier", srgb(0x1F3E8C), 0.5))
# Advertising boards and a grandstand line behind the barrier: something for the pan to streak.
for k in range(240):
    a = A0 + (A1 - A0) * k / 240
    r = OUT_EDGE + 16
    col = [0xF2F3F5, 0xFF4B2B, 0x15171B, 0x2E6BD9, 0xF2F3F5, 0xFFB020][k % 6]
    bpy.ops.mesh.primitive_cube_add(size=1, location=(r * math.cos(a), r * math.sin(a), 1.6))
    b = bpy.context.object
    b.scale = (0.3, (A1 - A0) / 240 * r * 0.9, 1.4)
    b.rotation_euler = (0, 0, a)
    b.data.materials.append(principled(f"board{k % 6}", srgb(col), 0.45))

# --- the car ---------------------------------------------------------------------------------
BODY, ACCENT = {"paneo": (0xD8301C, 0x15171B), "frente": (0xE9ECEF, 0xFF4B2B), "baja": (0x13606E, 0x3DDC97)}[SHOT]
bpy.ops.import_scene.gltf(filepath=str(ASSETS / "car.glb"))
parts = list(bpy.context.selected_objects)
root = next(o for o in parts if o.parent is None)
mats = {
    "carbon_fiber": principled("carbon", srgb(0x16171A), 0.35, 0.2, 0.6),
    "tier": principled("tyre", srgb(0x141416), 0.85),
    "chrome": principled("chrome", (0.8, 0.8, 0.8), 0.15, 1.0),
    "mirror": principled("mirror", (0.9, 0.9, 0.9), 0.02, 1.0),
    "glass": principled("glass", (0.02, 0.02, 0.02), 0.05, 0.0, 1.0),
    "chassis": principled("paint", srgb(BODY), 0.28, 0.3, 1.0),
    "coler": principled("accent", srgb(ACCENT), 0.3, 0.3, 1.0),
}
wheels = []
for o in parts:
    if o.type != "MESH":
        continue
    for slot in o.material_slots:
        base = slot.material.name.split(".")[0] if slot.material else "carbon_fiber"
        slot.material = mats.get(base, mats["carbon_fiber"])
    if o.parent and o.parent.name.startswith("wheel_"):
        wheels.append(o)
for w in wheels:
    bpy.ops.object.select_all(action="DESELECT")
    w.select_set(True)
    bpy.context.view_layer.objects.active = w
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    w.rotation_mode = "XYZ"
root.rotation_mode = "XYZ"

# --- the shot: camera and car move together, so only the world blurs ------------------------
cam_data = bpy.data.cameras.new("cam")
cam_data.sensor_width = 36
cam_data.dof.use_dof = True
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
R_CAR = RC - 1.5
# (camera radius, angle ahead of the car in m, height, lens, f-stop, aim ahead in m, aim height)
SHOTS = {
    "paneo": (IN - 10.0, -0.4, 0.8, 50, 2.8, 0.2, 0.45),
    "frente": (RC - 4.6, 9.5, 0.35, 35, 2.2, -0.6, 0.45),
    "baja": (RC + 2.6, 7.0, 0.3, 24, 2.0, -3.4, 0.45),
}
cr, ahead, ch, lens, fstop, aim_ahead, aim_h = SHOTS[SHOT]
cam_data.lens = lens
cam_data.dof.aperture_fstop = fstop


def place(frame):
    t = (frame - 1) / FPS
    a = -0.2 + SPEED / RC * t
    root.location = (R_CAR * math.cos(a), R_CAR * math.sin(a), 0)
    root.rotation_euler = (0, 0, a + HEADING)
    root.keyframe_insert("location", frame=frame)
    root.keyframe_insert("rotation_euler", frame=frame)
    for w in wheels:
        w.rotation_euler = (0, t * SPEED / 0.36, 0)
        w.keyframe_insert("rotation_euler", frame=frame)
    ca = a + ahead / RC
    cam.location = (cr * math.cos(ca), cr * math.sin(ca), ch)
    aim_a = a + aim_ahead / RC
    target = Vector((R_CAR * math.cos(aim_a), R_CAR * math.sin(aim_a), aim_h))
    cam.rotation_euler = (target - cam.location).normalized().to_track_quat("-Z", "Y").to_euler()
    cam.keyframe_insert("location", frame=frame)
    cam.keyframe_insert("rotation_euler", frame=frame)
    cam_data.dof.focus_distance = (target - cam.location).length
    cam_data.keyframe_insert("dof.focus_distance", frame=frame)


for f in range(1, 12):
    place(f)
scene.frame_start, scene.frame_end = 1, 11
scene.frame_set(6)
OUT.mkdir(parents=True, exist_ok=True)
scene.render.image_settings.file_format = "JPEG"
scene.render.image_settings.quality = 90
scene.render.filepath = str(OUT / f"{SHOT}.jpg")
bpy.ops.render.render(write_still=True)
