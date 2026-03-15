"""Tests for note storage (uses a temporary ChromaDB)."""

import os
import tempfile

import pytest

# Override ChromaDB path before importing anything that uses it
_tmpdir = tempfile.mkdtemp()
os.environ["SECOND_BRAIN_TEST"] = "1"

import second_brain.config as config
config.CHROMA_PERSIST_DIR = os.path.join(_tmpdir, "chroma")

from second_brain.notes.store import add_note, get_note, delete_note, list_notes, import_notes
from second_brain.storage.vector_store import count, _client, _collection
import second_brain.storage.vector_store as vs

# Reset the cached client/collection for each test module run
vs._client = None
vs._collection = None


def test_add_and_get():
    note = add_note(
        attendees=["Daniel Tehan", "John Smith"],
        date="2026-03-15T10:00:00",
        subject="Test Meeting",
        content="Discussed testing infrastructure",
    )
    result = get_note(note.id)
    assert result is not None
    assert result["metadata"]["subject"] == "Test Meeting"
    assert "Daniel Tehan" in result["metadata"]["attendees"]


def test_delete():
    note = add_note(
        attendees=["Alice"],
        date="2026-03-15T10:00:00",
        subject="To Be Deleted",
        content="This will be deleted",
    )
    assert get_note(note.id) is not None
    assert delete_note(note.id)
    assert get_note(note.id) is None


def test_list_notes():
    initial = count()
    add_note(
        attendees=["Bob"],
        date="2026-03-15T10:00:00",
        subject="List Test",
        content="For listing",
    )
    notes = list_notes()
    assert len(notes) > initial


def test_import():
    text = """
-----------------------------------------------------------
Tehan, Daniel, Test, User
Tehan, Daniel at 3/10/26 10:00 AM
RE: Import Test Meeting
\t• Testing import functionality
-----------------------------------------------------------
"""
    notes = import_notes(text)
    assert len(notes) == 1
    assert notes[0].subject == "Import Test Meeting"
    result = get_note(notes[0].id)
    assert result is not None
