"""Spanish text normalisation for the engineer's radio: numbers and units as words.

MeloTTS reads digits poorly, and radio lines are full of them ("1,2", "0,3 s",
"P5", "1:35.987"). Everything is spelled out the way an Argentine engineer says it.
"""

import re

from num2words import num2words

UNITS = {
    "km/h": "kilómetros por hora",
    "%": "por ciento",
    "°C": "grados",
    "°": "grados",
    "º": "grados",
    "kg": "kilos",
    "MJ": "megajulios",
    "s": "segundos",
}


def _int(n: str) -> str:
    return num2words(int(n), lang="es")


def _decimal(whole: str, frac: str) -> str:
    # "1,25" -> "uno coma veinticinco"; "0,05" -> "cero coma cero cinco"
    lead = "".join("cero " for _ in range(len(frac) - len(frac.lstrip("0"))))
    rest = frac.lstrip("0")
    return f"{_int(whole)} coma {lead}{_int(rest) if rest else ''}".strip()


def _lap_time(m: str, s: str, ms: str | None) -> str:
    # "1:35.987" -> "uno treinta y cinco nueve ocho siete", as engineers read lap times
    out = f"{_int(m)} {_int(s)}"
    if ms:
        out += " " + " ".join(_int(d) for d in ms)
    return out


def normalize(text: str) -> str:
    t = text.replace("−", "-").replace("–", "-")
    t = re.sub(r"\b(\d+):(\d{2})(?:[.,](\d{1,3}))?\b", lambda m: _lap_time(*m.groups()), t)
    t = re.sub(r"\bP(\d+)\b", lambda m: f"pe {_int(m.group(1))}", t)
    t = re.sub(r"\bV(\d+)\b", lambda m: f"vuelta {_int(m.group(1))}", t)
    t = re.sub(r"\bS([123])\b", lambda m: f"sector {_int(m.group(1))}", t)
    t = re.sub(r"(?<![\w,.])-(?=\d)", "menos ", t)
    t = re.sub(r"\+(?=\d)", "más ", t)
    unit = "|".join(re.escape(u) for u in sorted(UNITS, key=len, reverse=True))
    t = re.sub(rf"(\d)\s*({unit})(?![\w/])", lambda m: f"{m.group(1)} {UNITS[m.group(2)]}", t)
    t = re.sub(r"\b(\d+)[.,](\d+)\b", lambda m: _decimal(*m.groups()), t)
    t = re.sub(r"\b\d+\b", lambda m: _int(m.group(0)), t)
    # "uno" agrees with the noun: "veintiún segundos", "una vuelta".
    t = re.sub(r"\bveintiuno (?=(segundos|kilómetros|grados|kilos|megajulios|puntos)\b)", "veintiún ", t)
    t = re.sub(r"\buno (?=(segundos|kilómetros|grados|kilos|megajulios|puntos)\b)", "un ", t)
    t = re.sub(r"\b(veinti)?uno (?=(vueltas?|décimas?|curvas?|paradas?)\b)", lambda m: (m.group(1) or "") + "una ", t)
    return re.sub(r"\s+", " ", t).strip()
