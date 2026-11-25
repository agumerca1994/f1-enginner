"""The intro's soundtrack, synthesised from the same car paths as intro.py.

Each car is a train of exhaust pulses (six cylinders, each firing a little differently, so it
rasps instead of whining) shaped by a few resonances, heard at the camera: delayed by the speed
of sound (which gives the Doppler drop by itself), dull and mostly echo when far, dry and bright
when it passes, panned by where it is in the frame, with an upshift once it has gone by.
Then a track ambience and, at the end, the app's own radio chime (lib/voice.ts OPEN_TONES).

    <blender python> audio.py out.wav     (Blender's own Python has numpy)
"""
import math
import sys
import wave

import numpy as np

SR = 48000
SECONDS = 5.5
RC, SPEED = 300.0, 66.0
CAM = np.array([RC - 7.5 - 0.9, 0.0])
LOOK = np.array([(RC - 1.0) * math.cos(-0.3), (RC - 1.0) * math.sin(-0.3)])
CARS = [{"a0": -0.86 - n * 0.072, "r": [RC + 2.6, RC + 1.2, RC + 3.4, RC - 4.3][n], "phase": n * 1.7, "rpm": [10900, 11150, 10800, 11300][n]} for n in range(4)]
CHIME_AT = SECONDS - 0.45  # home.js shows the title at duration - 0.45, after the last car
CHIME = [(784, 0.092), (1175, 0.092), (988, 0.092)]  # same as the app's radio (lib/voice.ts)
C_SOUND = 343.0
rng = np.random.default_rng(7)
t = np.arange(int(SR * SECONDS)) / SR


def car_xy(c, te):
    a = c["a0"] + SPEED / RC * te
    r = c["r"] + 0.35 * np.sin(te * 1.3 + c["phase"])
    return np.stack([r * np.cos(a), r * np.sin(a)], axis=-1)


def one_pole(x, cutoff):
    """Low-pass with a cutoff (Hz) that can change every sample."""
    k = 1 - np.exp(-2 * np.pi * np.asarray(cutoff) / SR) * np.ones_like(x)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += k[i] * (x[i] - acc)
        y[i] = acc
    return y


def bandpass(x, f, q):
    """RBJ band-pass biquad (constant peak gain)."""
    w = 2 * math.pi * f / SR
    al = math.sin(w) / (2 * q)
    b0, b2 = al, -al
    a0, a1, a2 = 1 + al, -2 * math.cos(w), 1 - al
    b0, b2, a1, a2 = b0 / a0, b2 / a0, a1 / a0, a2 / a0
    y = np.empty_like(x)
    x1 = x2 = y1 = y2 = 0.0
    for i in range(len(x)):
        v = b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, x[i], y1, v
        y[i] = v
    return y


def engine(c):
    # Emission time for each sample: te + d(te)/c = t.
    te = t.copy()
    for _ in range(4):
        d = np.linalg.norm(car_xy(c, te) - CAM, axis=1)
        te = t - d / C_SOUND
    pos = car_xy(c, te)
    d = np.maximum(np.linalg.norm(pos - CAM, axis=1), 2.5)
    a = c["a0"] + SPEED / RC * te
    # Revs climb out of the corner; one upshift ~25 m after passing the camera.
    rpm = c["rpm"] * (1 + 0.05 * np.clip((a + 0.15) / 0.25, 0, 1))
    rpm = np.where(a > 0.085, rpm * 0.88 * (1 + 0.04 * np.clip((a - 0.085) / 0.1, 0, 1)), rpm)
    f = rpm / 60 * 3  # firings per second, six cylinders four-stroke
    cyc = np.cumsum(f * np.gradient(te)) + c["phase"]
    idx = np.floor(cyc).astype(int)
    frac = cyc - idx
    # Each firing a little different: the cylinders' pattern plus jitter. That is the rasp.
    pattern = np.array([1.0, 0.58, 0.9, 0.5, 0.95, 0.68])
    jitter = 1 + 0.2 * rng.standard_normal(idx.max() + 2)
    amp = pattern[idx % 6] * jitter[idx]
    pulse = amp * np.exp(-frac / 0.09)
    pulse -= pulse.mean()
    turb = rng.standard_normal(len(t)) * (0.25 + pulse.clip(0))
    src = pulse + 0.35 * turb
    body = 1.0 * bandpass(src, 150, 1.0) + 0.7 * bandpass(src, 520, 1.4) + 0.55 * bandpass(src, 1800, 2.5) + 0.25 * bandpass(src, 4200, 2)
    # Air and distance: far away only the low end arrives.
    cut = 320 + 14000 * np.clip(6 / d, 0, 1) ** 1.2
    dry = one_pole(one_pole(body, cut), cut) * d ** -1.15
    # The echo off the stands and the trees carries the far sound.
    wet = one_pole(one_pole(body, 700), 700) * (0.03 / np.sqrt(d))
    # Pan: positive cross product = the left of the frame (the side the cars leave by).
    view = (LOOK - CAM) / np.linalg.norm(LOOK - CAM)
    rel = (pos - CAM) / d[:, None]
    side = np.clip(view[0] * rel[:, 1] - view[1] * rel[:, 0], -1, 1)
    left, right = np.sqrt((1 + side) / 2), np.sqrt((1 - side) / 2)
    print(f"car r={c['r']:.1f} passes at {t[np.argmin(d)]:.2f}s, closest {d.min():.1f} m")
    return np.stack([dry * left, dry * right], axis=1), wet


def reverb(x, seconds=1.6, decay=0.38):
    n = int(SR * seconds)
    out = np.zeros((len(x), 2))
    m = len(x) + n
    for ch in range(2):
        ir = one_pole(rng.standard_normal(n), 2500) * np.exp(-np.arange(n) / (SR * decay))
        ir /= np.sqrt((ir**2).sum())
        out[:, ch] = np.fft.irfft(np.fft.rfft(x, m) * np.fft.rfft(ir, m), m)[: len(x)]
    return out


def chime():
    out = np.zeros(len(t))
    s = int(CHIME_AT * SR)
    for hz, length in CHIME:
        n = int(length * SR)
        tt = np.arange(n) / SR
        env = np.minimum(1, np.minimum(tt, tt[::-1]) / 0.004)
        out[s : s + n] += np.sin(2 * np.pi * hz * tt) * env
        s += n
    return np.stack([out, out], axis=1)


dry = np.zeros((len(t), 2))
wet = np.zeros(len(t))
for c in CARS:
    d_, w_ = engine(c)
    dry += d_
    wet += w_
mix = dry + reverb(wet)
mix /= np.max(np.abs(mix)) / 0.85
# Track ambience: a low wind bed and distant crowd hiss.
bed = one_pole(rng.standard_normal(len(t)), 250) * 0.06 + one_pole(rng.standard_normal(len(t)), 3000) * 0.006
mix += np.stack([bed, np.roll(bed, 900)], axis=1)
fade = np.minimum(1, np.minimum(t / 0.5, (SECONDS - t) / 0.3))
mix *= fade[:, None]
mix += chime() * 0.2
mix /= max(1.0, np.max(np.abs(mix)) / 0.95)

with wave.open(sys.argv[1], "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype("<i2").tobytes())
print("written", sys.argv[1])
