"""Request and response shapes for support tickets, the help center (KB), error groups and status."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas import UtcDatetime

Category = Literal["bug", "question", "billing", "feature"]
Priority = Literal["low", "normal", "high", "urgent"]
TicketStatus = Literal["open", "pending", "resolved", "closed"]


def _strip(v: str) -> str:
    return v.strip()


# --- Tickets -----------------------------------------------------------------------------------


class TicketIn(BaseModel):
    subject: str = Field(min_length=3, max_length=200)
    body: str = Field(min_length=10, max_length=10_000)
    category: Category = "question"
    page_url: str | None = Field(default=None, max_length=500)
    error_event_id: str | None = Field(default=None, max_length=64, pattern=r"^[A-Za-z0-9-]+$")

    _s = field_validator("subject", "body")(_strip)


class MessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=10_000)

    _s = field_validator("body")(_strip)


class StaffMessageIn(MessageIn):
    internal: bool = False


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    author_name: str
    is_staff: bool
    internal: bool
    body: str
    created_at: UtcDatetime


class TicketOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    subject: str
    category: str
    priority: str
    status: str
    error_event_id: str | None
    kb_article_id: str | None
    created_at: UtcDatetime
    updated_at: UtcDatetime
    resolved_at: UtcDatetime | None


class TicketDetailOut(TicketOut):
    messages: list[MessageOut]


class StaffTicketOut(TicketOut):
    workspace_name: str = ""
    requester_name: str = ""
    requester_email: str = ""
    page_url: str | None = None
    error_group_id: str | None = None
    first_response_at: UtcDatetime | None = None


class StaffTicketDetailOut(StaffTicketOut):
    messages: list[MessageOut]


class TicketPatch(BaseModel):
    status: TicketStatus | None = None
    priority: Priority | None = None
    error_group_id: str | None = None
    kb_article_id: str | None = None


class SupportMetrics(BaseModel):
    tickets_this_week: int
    open_tickets: int
    median_first_response_hours: float | None
    deflections_this_week: int
    deflection_rate: float | None  # deflections / (deflections + tickets), last 7 days
    new_errors_this_week: int
    errors_without_article: int


# --- Knowledge base ----------------------------------------------------------------------------


class ArticleSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    slug: str
    title: str
    summary: str
    tags: list[str]
    updated_at: UtcDatetime


class ArticleOut(ArticleSummary):
    body: str
    helpful_yes: int
    helpful_no: int


class StaffArticleOut(ArticleOut):
    status: str
    views: int
    source_ticket_id: str | None
    published_at: UtcDatetime | None


class ArticleIn(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    summary: str = Field(default="", max_length=300)
    body: str = Field(default="", max_length=100_000)
    tags: list[str] = Field(default_factory=list, max_length=10)
    status: Literal["draft", "published"] = "draft"
    slug: str | None = Field(default=None, max_length=120, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

    @field_validator("tags")
    @classmethod
    def _tags(cls, v: list[str]) -> list[str]:
        return sorted({t.strip().lower()[:40] for t in v if t.strip()})


class FeedbackIn(BaseModel):
    helpful: bool


class DeflectionIn(BaseModel):
    article_id: str = Field(max_length=32)


# --- Errors ------------------------------------------------------------------------------------


class ErrorGroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    glitchtip_issue_id: str
    title: str
    culprit: str | None
    level: str
    url: str | None
    status: str
    count: int
    kb_article_id: str | None
    first_seen: UtcDatetime
    last_seen: UtcDatetime
    ticket_count: int = 0


class ErrorGroupPatch(BaseModel):
    status: Literal["new", "known", "fixed"] | None = None
    kb_article_id: str | None = None


class ErrorHelpOut(BaseModel):
    slug: str
    title: str
    summary: str


# --- Status ------------------------------------------------------------------------------------

Impact = Literal["minor", "major", "maintenance"]
IncidentStatus = Literal["investigating", "identified", "monitoring", "resolved"]


class IncidentIn(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    impact: Impact = "minor"
    components: list[str] = Field(default_factory=list, max_length=10)
    message: str = Field(min_length=3, max_length=5000)
    status: IncidentStatus = "investigating"


class IncidentUpdateIn(BaseModel):
    status: IncidentStatus
    message: str = Field(min_length=3, max_length=5000)


class IncidentUpdateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    status: str
    message: str
    created_at: UtcDatetime


class IncidentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    title: str
    impact: str
    status: str
    components: list[str]
    created_at: UtcDatetime
    resolved_at: UtcDatetime | None
    updates: list[IncidentUpdateOut]
