from dataclasses import dataclass, field
from datetime import datetime
import uuid


@dataclass
class MeetingNote:
    attendees: list[str]
    date: datetime
    subject: str
    content: str
    source: str = "manual"
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    created_at: datetime = field(default_factory=datetime.now)
    chat_id: str | None = None
    message_count: int | None = None

    def metadata(self) -> dict:
        """Return metadata dict for ChromaDB storage."""
        meta = {
            "attendees": ", ".join(self.attendees),
            "date": self.date.isoformat(),
            "subject": self.subject,
            "source": self.source,
            "created_at": self.created_at.isoformat(),
        }
        if self.chat_id is not None:
            meta["chat_id"] = self.chat_id
        if self.message_count is not None:
            meta["message_count"] = self.message_count
        return meta

    def to_document(self) -> str:
        """Return the text to embed — includes subject and content for richer search."""
        return f"Subject: {self.subject}\nAttendees: {', '.join(self.attendees)}\n\n{self.content}"
