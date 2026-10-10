"""Names for the numeric codes of the F1 24 specification (appendices)."""

TRACKS = {
    0: "Melbourne", 1: "Paul Ricard", 2: "Shanghai", 3: "Sakhir (Bahrain)", 4: "Catalunya",
    5: "Monaco", 6: "Montreal", 7: "Silverstone", 8: "Hockenheim", 9: "Hungaroring",
    10: "Spa", 11: "Monza", 12: "Singapore", 13: "Suzuka", 14: "Abu Dhabi", 15: "Texas",
    16: "Brazil", 17: "Austria", 18: "Sochi", 19: "Mexico", 20: "Baku (Azerbaijan)",
    21: "Sakhir Short", 22: "Silverstone Short", 23: "Texas Short", 24: "Suzuka Short",
    25: "Hanoi", 26: "Zandvoort", 27: "Imola", 28: "Portimão", 29: "Jeddah", 30: "Miami",
    31: "Las Vegas", 32: "Losail",
}

SESSION_TYPES = {
    0: "Unknown", 1: "Practice 1", 2: "Practice 2", 3: "Practice 3", 4: "Short Practice",
    5: "Qualifying 1", 6: "Qualifying 2", 7: "Qualifying 3", 8: "Short Qualifying",
    9: "One-Shot Qualifying", 10: "Sprint Shootout 1", 11: "Sprint Shootout 2",
    12: "Sprint Shootout 3", 13: "Short Sprint Shootout", 14: "One-Shot Sprint Shootout",
    15: "Race", 16: "Race 2", 17: "Race 3", 18: "Time Trial",
}

WEATHER = {0: "Clear", 1: "Light cloud", 2: "Overcast", 3: "Light rain", 4: "Heavy rain", 5: "Storm"}

SAFETY_CAR_STATUS = {0: "None", 1: "Full safety car", 2: "Virtual safety car", 3: "Formation lap"}

VISUAL_COMPOUNDS = {16: "Soft", 17: "Medium", 18: "Hard", 7: "Intermediate", 8: "Wet"}

ACTUAL_COMPOUNDS = {
    16: "C5", 17: "C4", 18: "C3", 19: "C2", 20: "C1", 21: "C0", 22: "C6",
    7: "Intermediate", 8: "Wet",
}

PIT_STATUS = {0: "On track", 1: "Pitting", 2: "In pit area"}

# car_status.vehicle_fia_flags (-1 unknown)
FIA_FLAGS = {-1: None, 0: "none", 1: "green", 2: "blue", 3: "yellow", 4: "red"}

# car_telemetry.surface_type, per wheel
SURFACE_TYPES = {
    0: "tarmac", 1: "rumble_strip", 2: "concrete", 3: "rock", 4: "gravel", 5: "mud",
    6: "sand", 7: "grass", 8: "water", 9: "cobblestone", 10: "metal", 11: "ridged",
}
# Surfaces that mean the car ran wide off the racing line.
OFF_TRACK_SURFACES = frozenset({"grass", "gravel", "sand", "mud"})

ERS_DEPLOY_MODES = {0: "None", 1: "Medium", 2: "Hotlap", 3: "Overtake"}

FUEL_MIX = {0: "Lean", 1: "Standard", 2: "Rich", 3: "Max"}

TEAMS = {
    0: "Mercedes", 1: "Ferrari", 2: "Red Bull Racing", 3: "Williams", 4: "Aston Martin",
    5: "Alpine", 6: "RB", 7: "Haas", 8: "McLaren", 9: "Sauber",
}

# Joules the ERS store holds when full.
ERS_MAX_ENERGY = 4_000_000.0
