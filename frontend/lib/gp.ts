// The grand prix each track hosts, in Spanish, by the game's track id.
const GP: Record<number, string> = {
  0: "Australia", 1: "Francia", 2: "China", 3: "Baréin", 4: "España", 5: "Mónaco", 6: "Canadá",
  7: "Gran Bretaña", 8: "Alemania", 9: "Hungría", 10: "Bélgica", 11: "Italia", 12: "Singapur",
  13: "Japón", 14: "Abu Dabi", 15: "Estados Unidos", 16: "São Paulo", 17: "Austria", 18: "Rusia",
  19: "Ciudad de México", 20: "Azerbaiyán", 21: "Baréin", 22: "Gran Bretaña", 23: "Estados Unidos",
  24: "Japón", 25: "Vietnam", 26: "Países Bajos", 27: "Emilia-Romaña", 28: "Portugal",
  29: "Arabia Saudita", 30: "Miami", 31: "Las Vegas", 32: "Qatar", 39: "Gran Bretaña",
  40: "Austria", 41: "Países Bajos", 42: "España",
};

// The circuit's own name, for the line under the grand prix.
const CIRCUIT: Record<number, string> = {
  0: "Albert Park", 1: "Paul Ricard", 2: "Shanghái", 3: "Sakhir", 4: "Barcelona-Catalunya", 5: "Montecarlo",
  6: "Gilles Villeneuve", 7: "Silverstone", 8: "Hockenheim", 9: "Hungaroring", 10: "Spa-Francorchamps",
  11: "Monza", 12: "Marina Bay", 13: "Suzuka", 14: "Yas Marina", 15: "Circuito de las Américas",
  16: "Interlagos", 17: "Red Bull Ring", 18: "Sochi", 19: "Hermanos Rodríguez", 20: "Bakú",
  21: "Sakhir corto", 22: "Silverstone corto", 23: "Austin corto", 24: "Suzuka corto", 25: "Hanói",
  26: "Zandvoort", 27: "Imola", 28: "Portimão", 29: "Yeda", 30: "Miami", 31: "Las Vegas", 32: "Lusail",
  39: "Silverstone invertido", 40: "Red Bull Ring invertido", 41: "Zandvoort invertido", 42: "Madring",
};

export const gpName = (trackId: number | null | undefined) => (trackId != null && GP[trackId] ? GP[trackId] : null);
export const circuitName = (trackId: number | null | undefined, fallback?: string | null) =>
  (trackId != null && CIRCUIT[trackId]) || fallback || null;
