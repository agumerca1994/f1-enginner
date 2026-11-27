"""Text written for the screen, rewritten to be read aloud (mirrors frontend/lib/spoken.ts).

A speech engine reads "3°" as "3 grados", "0,3 s" as "0,3 siglos" and "1:28,456" as a clock
time; the engineer says "tercero", "0,3 segundos" and "1 minuto 28 con 456".
"""

import re

ORDINALS = ("", "primero", "segundo", "tercero", "cuarto", "quinto", "sexto", "séptimo", "octavo", "noveno", "décimo",
            "undécimo", "duodécimo", "decimotercero", "decimocuarto", "decimoquinto", "decimosexto", "decimoséptimo",
            "decimoctavo", "decimonoveno", "vigésimo")


def ordinal(n: int) -> str:
    if 1 <= n <= 20:
        return ORDINALS[n]
    if 20 < n < 30:
        return f"vigésimo {ORDINALS[n - 20]}"
    return f"puesto {n}"


def _lap_time(m: re.Match) -> str:
    minutes, secs, ms = m.groups()
    return f"{'un minuto' if minutes == '1' else minutes + ' minutos'} {int(secs)} con {ms}"


def spoken(text: str) -> str:
    text = re.sub(r"(\d+(?:[.,]\d+)?)\s?°C\b", r"\1 grados", text)
    text = re.sub(r"\b(\d{1,2})\s?[°º](?![CF])", lambda m: ordinal(int(m.group(1))), text)
    text = re.sub(r"\bP(\d{1,2})\b", lambda m: ordinal(int(m.group(1))), text)
    text = re.sub(r"\b(\d{1,2}):(\d{2})[.,](\d{1,3})\b", _lap_time, text)
    text = re.sub(r"(\d)\.(\d{1,2})(?!\d)", r"\1,\2", text)
    text = re.sub(r"\s?s/vuelta\b", " segundos por vuelta", text)
    text = re.sub(r"/vuelta\b", " por vuelta", text)
    text = re.sub(r"\bkm/h\b", "kilómetros por hora", text)
    text = re.sub(r"\bMJ\b", "megajulios", text)
    text = re.sub(r"\bVSC\b", "safety car virtual", text)
    text = re.sub(r"±\s?", "más o menos ", text)
    return re.sub(r"(\d+(?:,\d+)?)\s?s\b(?![\wáéíóú])",
                  lambda m: f"{m.group(1)} {'segundo' if m.group(1) == '1' else 'segundos'}", text)
