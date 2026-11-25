"""The intro's soundtrack, synthesised from the same car paths as intro.py.

Each car is an engine tone heard at the camera: delayed by the speed of sound (which gives the
Doppler drop by itself), louder and brighter when close, panned by where it is in the frame.
Then a quiet track ambience and, at the end, the radio's two beeps.

    <blender python> audio.py out.wav     (Blender's own Python has numpy)
"""
import math
import sys
import wave

import numpy as np

SR = 48000
SECONDS = 5.5
FPS = 60
RC, SPEED = 300.0, 66.0
CAM = np.array([RC - 7.5 - 0.9, 0.0])
LOOK = np.array([(RC - 1.0) * math.cos(-0.3), (RC - 1.0) * math.sin(-0.3)])
CARS = [{"a0": -0.86 - n * 0.072, "r": [RC + 2.6, RC + 1.2, RC + 3.4, RC - 4.3][n], "phase": n * 1.7, "rpm": [11400, 11650, 11250, 11800][n]} for n in range(4)]
BEEP_AT = SECONDS - 0.45  # home.js shows the title at duration - 0.45, after the last car
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


def engine(c):
    # Emission time for each sample: te + d(te)/c = t.
    te = t.copy()
    for _ in range(4):
        d = np.linalg.norm(car_xy(c, te) - CAM, axis=1)
        te = t - d / C_SOUND
    pos = car_xy(c, te)
    d = np.maximum(np.linalg.norm(pos - CAM, axis=1), 2.5)
    # Firing frequency of a 6-cylinder four-stroke, with a little throttle wobble.
    f = c["rpm"] / 60 * 3 * (1 + 0.012 * np.sin(te * 9 + c["phase"]))
    ph = 2 * np.pi * np.cumsum(f * np.gradient(te)) + c["phase"]
    tone = sum(np.sin(k * ph) / k**0.9 for k in range(1, 13)) + 0.5 * np.sin(0.5 * ph) + 0.3 * np.sin(1.5 * ph)
    tone = np.tanh(1.6 * tone)
    roar = rng.standard_normal(len(t))
    sig = tone + 0.35 * roar * (6 / d)
    # Far away only the low end arrives; close by it is bright.
    sig = one_pole(sig, 900 + 9000 * np.clip(8 / d, 0, 1))
    gain = (1 / d) ** 0.7  # softer than real falloff, so the train is heard from far away
    # Pan: positive cross product = the left of the frame (the side the cars leave by).
    view = (LOOK - CAM) / np.linalg.norm(LOOK - CAM)
    rel = (pos - CAM) / d[:, None]
    side = np.clip(view[0] * rel[:, 1] - view[1] * rel[:, 0], -1, 1)
    left = np.sqrt((1 + side) / 2)
    right = np.sqrt((1 - side) / 2)
    pass_t = t[np.argmin(d)]
    print(f"car r={c['r']:.1f} passes at {pass_t:.2f}s, closest {d.min():.1f} m")
    return np.stack([sig * gain * left, sig * gain * right], axis=1)


def reverb(x, seconds=0.9, mix=0.18):
    n = int(SR * seconds)
    ir = rng.standard_normal(n) * np.exp(-np.arange(n) / (SR * 0.18))
    ir[0] = 0
    out = np.empty_like(x)
    m = len(x) + n
    for ch in range(2):
        wet = np.fft.irfft(np.fft.rfft(x[:, ch], m) * np.fft.rfft(ir, m), m)[: len(x)]
        out[:, ch] = x[:, ch] + mix * wet / np.max(np.abs(ir).sum() ** 0.5)
    return out


def radio_beep():
    """Squelch click and static, then two short beeps, through a radio's narrow band."""
    out = np.zeros(len(t))
    s0 = int(BEEP_AT * SR)
    static = rng.standard_normal(int(0.07 * SR)) * 0.25 * np.linspace(1, 0.2, int(0.07 * SR))
    out[s0 : s0 + len(static)] += static
    for k, start in enumerate([0.07, 0.19]):
        n = int(0.085 * SR)
        tt = np.arange(n) / SR
        env = np.minimum(1, np.minimum(tt, tt[::-1]) / 0.004)
        tone = np.sign(np.sin(2 * np.pi * 1180 * tt)) * 0.35 + np.sin(2 * np.pi * 1180 * tt) * 0.4
        a = s0 + int(start * SR)
        out[a : a + n] += tone * env
    # Band-pass 300 Hz - 3 kHz.
    out = one_pole(out, 3000) - one_pole(one_pole(out, 3000), 300)
    return np.stack([out, out], axis=1)


mix = sum(engine(c) for c in CARS)
mix /= np.max(np.abs(mix)) / 0.85
# Track ambience: a low wind bed, faded in and out.
bed = one_pole(rng.standard_normal(len(t)), 350) * 0.05
fade = np.minimum(1, np.minimum(t / 0.4, (SECONDS - t) / 0.3))
mix += np.stack([bed, np.roll(bed, 900)], axis=1)
mix = reverb(mix)
mix *= fade[:, None]
beep = radio_beep()
mix += beep * (0.16 / np.max(np.abs(beep)))
mix /= max(1.0, np.max(np.abs(mix)) / 0.95)

with wave.open(sys.argv[1], "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype("<i2").tobytes())
print("written", sys.argv[1])
