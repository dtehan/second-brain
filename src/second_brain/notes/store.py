"""CRUD operations for notes — thin wrapper over vector_store."""

from datetime import datetime

from .models import MeetingNote
from .parser import parse_onenote_export
from ..storage import vector_store


def add_note(
    attendees: list[str],
    date: str,
    subject: str,
    content: str,
    source: str = "manual",
) -> MeetingNote:
    """Create and store a new meeting note."""
    note = MeetingNote(
        attendees=attendees,
        date=datetime.fromisoformat(date),
        subject=subject,
        content=content,
        source=source,
    )
    vector_store.add_note(note)
    return note


def import_notes(text: str) -> list[MeetingNote]:
    """Parse OneNote export text and store all notes."""
    notes = parse_onenote_export(text)
    if notes:
        vector_store.add_notes(notes)
    return notes


def get_note(note_id: str) -> dict | None:
    return vector_store.get_note(note_id)


def delete_note(note_id: str) -> bool:
    return vector_store.delete_note(note_id)


def list_notes(limit: int = 50, offset: int = 0) -> list[dict]:
    return vector_store.list_notes(limit=limit, offset=offset)


def add_chat_note(
    participants: list[str],
    date: str,
    subject: str,
    content: str,
    chat_id: str | None = None,
    message_count: int | None = None,
) -> tuple[MeetingNote | None, str]:
    """Create and store a chat note. Returns (note, message).

    If chat_id is provided and already exists, returns (None, duplicate_warning).
    """
    if chat_id:
        existing = vector_store.list_notes(
            where={"chat_id": chat_id}, limit=1
        )
        if existing:
            return None, f"Duplicate: chat_id '{chat_id}' already exists (note {existing[0]['id'][:8]})"

    note = MeetingNote(
        attendees=participants,
        date=datetime.fromisoformat(date),
        subject=subject,
        content=content,
        source="teams_chat",
        chat_id=chat_id,
        message_count=message_count,
    )
    vector_store.add_note(note)
    return note, f"Chat note added (id: {note.id}): {subject} with {', '.join(note.attendees)}"
