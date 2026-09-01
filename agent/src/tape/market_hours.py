"""US equity regular-hours clock, derived locally (the MCP server exposes no
clock tool; verified Sep 1). Sep 2026 = EDT = UTC-4: 13:30-20:00 UTC Mon-Fri.
Note in cycle.py receipt when this module's assumption needs review (DST:
after Nov 1 2026 the window becomes 14:30-21:00 UTC)."""

from __future__ import annotations

from datetime import datetime, timezone

OPEN_MIN = 13 * 60 + 30  # 13:30 UTC in EDT
CLOSE_MIN = 20 * 60  # 20:00 UTC in EDT
DST_ENDS = datetime(2026, 11, 1, tzinfo=timezone.utc)


def clock_now(now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    if now >= DST_ENDS:
        open_min, close_min = OPEN_MIN + 60, CLOSE_MIN + 60  # EST
    else:
        open_min, close_min = OPEN_MIN, CLOSE_MIN
    minutes = now.hour * 60 + now.minute
    is_weekday = now.weekday() < 5
    is_open = is_weekday and open_min <= minutes < close_min
    return {
        "timestamp": now.isoformat(timespec="seconds"),
        "is_open": is_open,
        "minutes_to_close": (close_min - minutes) if is_open else None,
        "minutes_to_open": (open_min - minutes) if (is_weekday and minutes < open_min) else None,
        "source": "local_us_regular_hours",
    }
