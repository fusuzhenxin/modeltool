"""Encrypted station credentials, model routing and task-level rotation."""
from .core import ident


def entries(station):
    if "key_pool" in station:
        return station["key_pool"]
    if station.get("key_cipher"):
        return [{"id": "legacy", "name": "默认 Key", "models": [], "enabled": True,
                 "cipher": station["key_cipher"]}]
    return []


def eligible(station, model):
    active = [key for key in entries(station) if key["enabled"] and key.get("cipher")]
    bound = [key for key in active if model in key["models"]]
    return bound or [key for key in active if not key["models"]]


def save_keys(db, data, previous):
    """Omission preserves secrets; blank values retain only a known entry's cipher."""
    submitted = data.pop("api_keys")
    single = data.pop("api_key")
    clear = data.pop("clear_key")
    previous = previous or {}
    if clear:
        data.update(key_pool=[], key_cipher="", key_cursors={})
    elif submitted is not None:
        existing = {key["id"]: key for key in entries(previous)}
        pool, seen = [], set()
        for item in submitted:
            key_id = item["id"] or ident()
            if key_id in seen or (item["id"] and key_id not in existing):
                raise ValueError("Key 记录已失效或重复，请重新打开编辑窗口")
            seen.add(key_id)
            cipher = db.encrypt(item["api_key"]) if item["api_key"] else existing.get(key_id, {}).get("cipher", "")
            if not cipher:
                raise ValueError("新增 Key 需要填写密钥")
            pool.append({"id": key_id, "name": item["name"], "models": item["models"],
                         "enabled": item["enabled"], "cipher": cipher})
        # Duplicate credentials would give one Key extra weight in the rotation.
        values = [db.decrypt(key["cipher"]) for key in pool]
        if len(set(values)) != len(values):
            raise ValueError("同一中转站不能重复添加相同的 Key")
        data.update(key_pool=pool, key_cipher="", key_cursors=previous.get("key_cursors", {}))
    elif single:
        data["key_cipher"] = db.encrypt(single)
    else:
        data["key_cipher"] = previous.get("key_cipher", "")
        if "key_pool" in previous:
            data.update(key_pool=previous["key_pool"], key_cursors=previous.get("key_cursors", {}))


def select_for_job(db, station, model, con):
    """Called while claiming a job under SQLite's write lock; pin one Key per job."""
    pool = eligible(station, model)
    if not pool:
        return station
    cursors = dict(station.get("key_cursors", {}))
    last = next((i for i, key in enumerate(pool) if key["id"] == cursors.get(model)), -1)
    selected = pool[(last + 1) % len(pool)]
    cursors[model] = selected["id"]
    db.save("stations", station["id"], {k: v for k, v in station.items() if k != "id"} | {"key_cursors": cursors}, con)
    return station | {"_selected_key": selected["id"]}


def key_for_model(db, station, model):
    pool = eligible(station, model)
    selected = station.get("_selected_key")
    key = next((key for key in pool if key["id"] == selected), None) if selected else next(iter(pool), None)
    return db.decrypt(key["cipher"]) if key else ""


def redact(db, station, text):
    for key in sorted((db.decrypt(item["cipher"]) for item in entries(station)), key=len, reverse=True):
        if key:
            text = text.replace(key, "[已移除密钥]")
    return text
