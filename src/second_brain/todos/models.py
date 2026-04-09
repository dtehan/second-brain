"""Todo item data model."""

import uuid
from dataclasses import dataclass, field
from datetime import datetime


@dataclass
class TodoItem:
    text: str
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    status: str = "pending"  # "pending" | "done"
    created_at: datetime = field(default_factory=datetime.now)

    def metadata(self) -> dict:
        return {
            "text": self.text,
            "status": self.status,
            "created_at": self.created_at.isoformat(),
        }

    def to_document(self) -> str:
        return self.text
