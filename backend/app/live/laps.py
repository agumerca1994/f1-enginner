"""Shared rules about laps that several modules apply the same way."""

RACE_SESSION_TYPES = (15, 16, 17)


def is_race(session_packet) -> bool:
    return session_packet is not None and int(session_packet.body["session_type"]) in RACE_SESSION_TYPES


def pit_sample(lap, track_length: float, race: bool) -> bool:
    """Whether this LapData sample makes the lap a pit lap.

    In a race any time in the pit lane counts. In practice and qualifying many
    pit exits sit after the timing line, so a flying lap starts in the pit lane
    without stopping: only a stop in the box, or the pit lane in the second half
    of the lap (the in-lap), makes it a pit lap there.
    """
    status = int(lap["pit_status"])
    if status == 0:
        return False
    if race or status == 2:
        return True
    return track_length > 0 and float(lap["lap_distance"]) > track_length / 2
