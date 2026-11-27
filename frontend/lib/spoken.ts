// Text written for the screen, rewritten to be read aloud. The speech engine reads "3°" as
// "3 grados", "0,3 s" as "0,3 siglos" and "1:28,456" as a clock time; the engineer says
// "tercero", "0,3 segundos" and "1 minuto 28 con 456". Mirrors backend/app/engineer/spoken.py.

const ORDINALS = [
  "", "primero", "segundo", "tercero", "cuarto", "quinto", "sexto", "séptimo", "octavo", "noveno", "décimo",
  "undécimo", "duodécimo", "decimotercero", "decimocuarto", "decimoquinto", "decimosexto", "decimoséptimo",
  "decimoctavo", "decimonoveno", "vigésimo",
];

export function ordinal(n: number): string {
  if (n >= 1 && n <= 20) return ORDINALS[n];
  if (n > 20 && n < 30) return `vigésimo ${ORDINALS[n - 20]}`;
  return `puesto ${n}`;
}

export function spoken(text: string): string {
  return (
    text
      // Temperatures before positions: "104 °C" is degrees.
      .replace(/(\d+(?:[.,]\d+)?)\s?°C\b/g, "$1 grados")
      // Positions: "3°", "3º", "P3".
      .replace(/\b(\d{1,2})\s?[°º](?![CF])/g, (_, n) => ordinal(Number(n)))
      .replace(/\bP(\d{1,2})\b/g, (_, n) => ordinal(Number(n)))
      // Lap times: "1:28,456" / "1:28.456".
      .replace(/\b(\d{1,2}):(\d{2})[.,](\d{1,3})\b/g, (_, m, s, ms) => `${m === "1" ? "un minuto" : `${m} minutos`} ${Number(s)} con ${ms}`)
      // Decimals with a dot are read as "punto": the comma is the Spanish way. Thousands (1.500) stay.
      .replace(/(\d)\.(\d{1,2})(?!\d)/g, "$1,$2")
      // Units.
      .replace(/\s?s\/vuelta\b/g, " segundos por vuelta")
      .replace(/\/vuelta\b/g, " por vuelta")
      .replace(/\bkm\/h\b/g, "kilómetros por hora")
      .replace(/\bMJ\b/g, "megajulios")
      .replace(/\bVSC\b/g, "safety car virtual")
      .replace(/±\s?/g, "más o menos ")
      // Seconds: "0,3 s", "1 s", "12s".
      .replace(/(\d+(?:,\d+)?)\s?s\b(?![\wáéíóú])/g, (_, n) => `${n} ${n === "1" ? "segundo" : "segundos"}`)
  );
}
