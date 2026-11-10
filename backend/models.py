from datetime import datetime
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def web_url(value, image=False, endpoint=False):
    if not value:
        return value
    if image and value.startswith("/media/"):
        import re
        if not re.fullmatch(r"/media/[a-f0-9]{24}\.webp", value):
            raise ValueError("站内图片需使用上传接口返回的地址")
        return value
    parsed = urlsplit(value)
    if parsed.scheme not in ("https", "http") or not parsed.hostname or parsed.username or parsed.password or any(ord(c) < 32 for c in value):
        raise ValueError("请输入不含用户名或密码的 http(s) 地址")
    if endpoint and (parsed.query or parsed.fragment):
        raise ValueError("接口地址不能带查询参数或锚点，请将密钥填入专用字段")
    if endpoint and parsed.port not in (None, 80, 443, 8080, 8443):
        raise ValueError("检测接口仅支持 80、443、8080、8443 端口")
    return value.rstrip("/")


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Credentials(StrictModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)
    username: str = Field(min_length=3, max_length=64, pattern=r"^[a-zA-Z0-9_.-]+$")
    password: str = Field(min_length=12, max_length=128)
    # Password whitespace is significant.
    @field_validator("password", mode="before")
    @classmethod
    def password_text(cls, value):
        return value


class Setup(Credentials):
    token: str = Field(min_length=20, max_length=200)


class PasswordChange(StrictModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)


class Timed(StrictModel):
    enabled: bool = True
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    order: int = Field(default=0, ge=-10000, le=10000)

    @model_validator(mode="after")
    def dates(self):
        for value in (self.starts_at, self.ends_at):
            if value and value.tzinfo is None:
                raise ValueError("时间必须包含时区")
        if self.starts_at and self.ends_at and self.ends_at <= self.starts_at:
            raise ValueError("结束时间必须晚于开始时间")
        return self


class Announcement(Timed):
    title: str = Field(min_length=1, max_length=100)
    content: str = Field(min_length=1, max_length=1500)
    link: str = Field(default="", max_length=500)
    placement: Literal["all", "home"] = "all"
    pinned: bool = False
    tone: Literal["info", "warning", "success"] = "info"
    background_color: str = Field(default="", pattern=r"^(#[0-9a-fA-F]{6})?$")
    text_color: str = Field(default="", pattern=r"^(#[0-9a-fA-F]{6})?$")

    @field_validator("link")
    @classmethod
    def link_url(cls, value):
        return web_url(value)


class ModelDiscovery(StrictModel):
    base_url: str = Field(min_length=8, max_length=500)
    protocol: Literal["openai", "anthropic"] = "openai"
    api_key: str | None = Field(default=None, max_length=1000)
    station_id: str | None = Field(default=None, max_length=100)

    @field_validator("base_url")
    @classmethod
    def base(cls, value):
        return web_url(value, endpoint=True)


class StationOrder(StrictModel):
    order: int = Field(ge=-10000, le=10000)


class Station(StrictModel):
    name: str = Field(min_length=1, max_length=80)
    base_url: str = Field(min_length=8, max_length=500)
    website_url: str = Field(default="", max_length=500)
    logo: str = Field(default="", max_length=500)
    description: str = Field(default="", max_length=1500)
    order: int = Field(default=0, ge=-10000, le=10000)
    models: list[str] = Field(min_length=1, max_length=30)
    protocol: Literal["openai", "anthropic"] = "openai"
    visible: bool = True
    enabled: bool = True
    api_key: str | None = Field(default=None, max_length=1000)
    clear_key: bool = False
    daily_calls: int = Field(default=60, ge=0, le=100000)
    daily_tokens: int = Field(default=60000, ge=0, le=100000000)
    baselines: dict[str, float] = Field(default_factory=dict, max_length=30)
    degradation_threshold: float = Field(default=20, ge=5, le=100)

    @field_validator("base_url")
    @classmethod
    def base(cls, value):
        return web_url(value, endpoint=True)

    @field_validator("logo")
    @classmethod
    def image(cls, value):
        return web_url(value, True)

    @field_validator("website_url")
    @classmethod
    def website(cls, value):
        return web_url(value)

    @field_validator("models")
    @classmethod
    def model_names(cls, value):
        values = list(dict.fromkeys(v.strip() for v in value))
        if any(not v or len(v) > 150 or any(ord(c) < 32 for c in v) for v in values):
            raise ValueError("模型名不能为空、过长或包含控制字符")
        return values

    @model_validator(mode="after")
    def valid_baselines(self):
        if any(k not in self.models or not 0 <= v <= 100 for k, v in self.baselines.items()):
            raise ValueError("基线需对应已登记模型，分数应在 0–100 之间")
        return self


class Ad(Timed):
    name: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=250)
    link: str = Field(min_length=8, max_length=500)
    image: str = Field(default="", max_length=500)
    placement: Literal["hero", "banner", "footer"] = "hero"

    @field_validator("link")
    @classmethod
    def link_url(cls, value):
        return web_url(value)

    @field_validator("image")
    @classmethod
    def image_url(cls, value):
        return web_url(value, True)


class Run(StrictModel):
    station_id: str = Field(min_length=1, max_length=100)
    model: str = Field(min_length=1, max_length=150)
    kind: Literal["site_basic", "site_ability", "site_logic", "site_code", "site_qa", "site_candy", "site_relay", "site_trace", "site_pelican", "site_all", "protocol", "ability", "combined", "pelican"] = "site_basic"
    pelican_mode: Literal["svg", "html2d", "three"] = "html2d"
    difficulty: Literal["easy", "medium", "hard"] = "medium"
    count: int = Field(default=10, ge=1, le=30)
    candy_count: int = Field(default=20, ge=1, le=30)


class Schedule(Run):
    name: str = Field(min_length=1, max_length=100)
    interval_minutes: int = Field(default=360, ge=1, le=43200)
    enabled: bool = True
    # Start at an explicit time; subsequent runs use the fixed interval.
    first_run: datetime | None = None

    @field_validator("first_run")
    @classmethod
    def zoned(cls, value):
        if value and value.tzinfo is None:
            raise ValueError("时间必须包含时区")
        return value


class ScheduleBatch(StrictModel):
    schedules: list[Schedule] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def unique_stations(self):
        ids = [item.station_id for item in self.schedules]
        if len(set(ids)) != len(ids):
            raise ValueError("同一批计划不能重复选择中转站")
        return self


class Settings(StrictModel):
    daily_calls: int = Field(ge=0, le=1000000)
    daily_tokens: int = Field(ge=0, le=1000000000)
    paused: bool = False


class Review(StrictModel):
    status: Literal["draft", "published", "rejected"]
    note: str = Field(default="", max_length=1500)
