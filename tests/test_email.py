"""Tests for email ingestion — add_email_note and list_processed_ids."""

import os
import tempfile

# Override ChromaDB path before importing anything that uses it
_tmpdir = tempfile.mkdtemp()
os.environ["SECOND_BRAIN_TEST"] = "1"

import second_brain.config as config
config.CHROMA_PERSIST_DIR = os.path.join(_tmpdir, "chroma")

from second_brain.notes.store import add_email_note, add_chat_note, get_processed_ids
from second_brain.search.semantic import search_notes
import second_brain.storage.vector_store as vs

# Reset the cached client/collection for each test module run
vs._client = None
vs._collection = None


def test_add_email_note():
    note, msg = add_email_note(
        participants=["Daniel Tehan", "Jane Doe"],
        date="2026-02-10T09:00:00",
        subject="Q1 Planning",
        content="Discussed Q1 priorities and resource allocation.",
        conversation_id="conv-001",
        email_message_id="msg-001",
    )
    assert note is not None
    assert note.source == "email_done"
    assert "Email note added" in msg
    meta = note.metadata()
    assert meta["conversation_id"] == "conv-001"
    assert meta["email_message_id"] == "msg-001"
    assert meta["folder"] == "done"


def test_add_email_note_sent_folder():
    note, msg = add_email_note(
        participants=["Daniel Tehan", "Bob Smith"],
        date="2026-02-11T10:00:00",
        subject="Follow-up: Budget Review",
        content="Sent follow-up on budget numbers.",
        conversation_id="conv-002",
        folder="sent",
    )
    assert note is not None
    assert note.source == "email_sent"
    assert note.folder == "sent"


def test_email_deduplication():
    note1, msg1 = add_email_note(
        participants=["Alice"],
        date="2026-02-12T11:00:00",
        subject="Dedup Email Test",
        content="First version",
        conversation_id="conv-dedup-001",
    )
    assert note1 is not None

    note2, msg2 = add_email_note(
        participants=["Alice"],
        date="2026-02-12T11:00:00",
        subject="Dedup Email Test",
        content="Second version",
        conversation_id="conv-dedup-001",
    )
    assert note2 is None
    assert "Duplicate" in msg2


def test_email_cross_folder_dedup():
    """Same conversation_id from done and sent folders should dedup."""
    note1, _ = add_email_note(
        participants=["Carol"],
        date="2026-02-13T09:00:00",
        subject="Cross Folder Test",
        content="From done folder",
        conversation_id="conv-cross-001",
        folder="done",
    )
    assert note1 is not None

    note2, msg2 = add_email_note(
        participants=["Carol"],
        date="2026-02-13T09:00:00",
        subject="Cross Folder Test",
        content="From sent folder",
        conversation_id="conv-cross-001",
        folder="sent",
    )
    assert note2 is None
    assert "Duplicate" in msg2


def test_email_notes_appear_in_search():
    add_email_note(
        participants=["Daniel Tehan", "Habib Matar"],
        date="2026-02-14T14:00:00",
        subject="Data Pipeline Outage",
        content="Discussed the production data pipeline outage and root cause analysis.",
        conversation_id="conv-search-001",
    )
    results = search_notes("data pipeline outage")
    assert any("Data Pipeline" in r["metadata"]["subject"] for r in results)


def test_list_processed_ids_email():
    result = get_processed_ids("email")
    assert "email" in result
    # Should contain the conversation_ids we added above
    assert "conv-001" in result["email"]
    assert "conv-002" in result["email"]


def test_list_processed_ids_mixed():
    # Add a chat note to have both types
    add_chat_note(
        participants=["Daniel Tehan"],
        date="2026-02-15T10:00:00",
        subject="Mixed Test Chat",
        content="Chat content",
        chat_id="chat-mixed-001",
    )

    result = get_processed_ids("all")
    assert "email" in result
    assert "chat" in result
    assert "chat-mixed-001" in result["chat"]
    assert len(result["email"]) > 0
