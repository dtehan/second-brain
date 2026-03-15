"""Tests for Teams chat ingestion — add_chat_note and suggest_subject."""

import os
import tempfile

# Override ChromaDB path before importing anything that uses it
_tmpdir = tempfile.mkdtemp()
os.environ["SECOND_BRAIN_TEST"] = "1"

import second_brain.config as config
config.CHROMA_PERSIST_DIR = os.path.join(_tmpdir, "chroma")

from second_brain.notes.store import add_note, add_chat_note, get_processed_ids
from second_brain.search.semantic import search_notes, suggest_subject
import second_brain.storage.vector_store as vs

# Reset the cached client/collection for each test module run
vs._client = None
vs._collection = None


def test_add_chat_note():
    note, msg = add_chat_note(
        participants=["Daniel Tehan", "Habib Matar"],
        date="2026-03-14T09:00:00",
        subject="Vantage Migration",
        content="Daniel: We need to migrate by Friday\nHabib: I'll handle the schema changes",
    )
    assert note is not None
    assert note.source == "teams_chat"
    assert "Chat note added" in msg
    assert note.chat_id is None


def test_add_chat_note_with_chat_id():
    note, msg = add_chat_note(
        participants=["Daniel Tehan", "John Smith"],
        date="2026-03-14T10:00:00",
        subject="Sprint Planning",
        content="John: Let's discuss priorities",
        chat_id="thread-123",
        message_count=5,
    )
    assert note is not None
    assert note.chat_id == "thread-123"
    assert note.message_count == 5
    meta = note.metadata()
    assert meta["chat_id"] == "thread-123"
    assert meta["message_count"] == 5


def test_deduplication():
    note1, msg1 = add_chat_note(
        participants=["Alice"],
        date="2026-03-14T11:00:00",
        subject="Dedup Test",
        content="First version",
        chat_id="dedup-001",
    )
    assert note1 is not None

    note2, msg2 = add_chat_note(
        participants=["Alice"],
        date="2026-03-14T11:00:00",
        subject="Dedup Test",
        content="Second version",
        chat_id="dedup-001",
    )
    assert note2 is None
    assert "Duplicate" in msg2


def test_suggest_subject_ranks_by_overlap():
    # Add a meeting note with known attendees
    add_note(
        attendees=["Daniel Tehan", "Habib Matar", "Sarah Jones"],
        date="2026-03-10T10:00:00",
        subject="Vantage DB Migration Planning",
        content="Discussed migration timeline and schema changes for Vantage",
    )
    add_note(
        attendees=["Bob Wilson", "Carol Lee"],
        date="2026-03-11T10:00:00",
        subject="Unrelated Marketing Meeting",
        content="Discussed marketing strategy and campaign plans",
    )

    results = suggest_subject(
        participants=["Daniel Tehan", "Habib Matar"],
        topic_hint="Vantage migration",
    )
    assert len(results) > 0
    # The note with overlapping participants should be ranked first
    top_result = results[0]
    assert "Daniel Tehan" in top_result["metadata"]["attendees"]


def test_chat_notes_appear_in_search():
    add_chat_note(
        participants=["Daniel Tehan", "Habib Matar"],
        date="2026-03-14T14:00:00",
        subject="Kubernetes Deployment",
        content="Daniel: The k8s pods are crashing\nHabib: Let me check the resource limits",
        chat_id="k8s-thread-001",
    )
    results = search_notes("kubernetes pods crashing")
    assert any("Kubernetes" in r["metadata"]["subject"] for r in results)


def test_list_processed_ids_chat():
    result = get_processed_ids("chat")
    assert "chat" in result
    # Should contain the chat_ids added in earlier tests
    assert "k8s-thread-001" in result["chat"]
