"""Plan timing in Beijing time, shared by saving and automatic dispatch."""
from datetime import datetime, timedelta

from .core import TZ, now


def next_daily(clock, current=None):
    current = now() if current is None else current
    local = datetime.fromtimestamp(current, TZ)
    hour, minute = map(int, clock.split(":"))
    target = local.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target.timestamp() <= current:
        target += timedelta(days=1)
    return target.timestamp()


def initial_run(data, current=None):
    current = now() if current is None else current
    mode = data.get("schedule_mode", "interval")
    if mode == "daily":
        return next_daily(data["daily_time"], current)
    first = datetime.fromisoformat(data["first_run"]).timestamp() if data.get("first_run") else None
    if mode == "once":
        return first
    return max(current, first) if first else current + data["interval_minutes"] * 60
