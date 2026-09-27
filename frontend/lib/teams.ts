// Team colours as shown in the game (F1 24 season).
export const TEAM_COLORS: Record<number, string> = {
  0: "#27f4d2", // Mercedes
  1: "#e8002d", // Ferrari
  2: "#3671c6", // Red Bull Racing
  3: "#64c4ff", // Williams
  4: "#229971", // Aston Martin
  5: "#ff87bc", // Alpine
  6: "#6692ff", // RB
  7: "#b6babd", // Haas
  8: "#ff8000", // McLaren
  9: "#52e252", // Sauber
};

export function teamColor(teamId: number | null | undefined): string {
  return (teamId != null && TEAM_COLORS[teamId]) || "#7d8996";
}

export const COMPOUND_COLORS: Record<string, string> = {
  Soft: "#e5484d",
  Medium: "#f5c542",
  Hard: "#eef2f6",
  Intermediate: "#3fb950",
  Wet: "#3b82f6",
};

export const COMPOUND_LETTER: Record<string, string> = {
  Soft: "B",
  Medium: "M",
  Hard: "D",
  Intermediate: "I",
  Wet: "LL",
};
