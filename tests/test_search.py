"""Tests for semantic search (uses temporary ChromaDB)."""

import os
import tempfile

_tmpdir = tempfile.mkdtemp()

import second_brain.config as config
config.CHROMA_PERSIST_DIR = os.path.join(_tmpdir, "chroma")

import second_brain.storage.vector_store as vs
vs._client = None
vs._collection = None

from second_brain.notes.store import add_note
from second_brain.search.semantic import search_notes, search_by_person, search_by_date_range
from second_brain.search.connections import find_connections, find_connections_by_topic


def _seed_notes():
    add_note(
        attendees=["Daniel Tehan", "Habib Ahmed"],
        date="2026-03-10T10:00:00",
        subject="MCP Integration Planning",
        content="Discussed building an MCP server for meeting notes. Need vector database for semantic search.",
    )
    add_note(
        attendees=["Daniel Tehan", "John Smith"],
        date="2026-03-12T14:00:00",
        subject="Cigna Demo Prep",
        content="Prepared SQL optimization demo for Cigna. Focused on ClearScape Analytics use cases.",
    )
    add_note(
        attendees=["Daniel Tehan", "Habib Ahmed", "Sarah Lee"],
        date="2026-03-14T09:00:00",
        subject="Data DNA Review",
        content="Reviewed OTF pipeline status. Habib presented new data integration approach.",
    )


_seed_notes()


def test_semantic_search():
    results = search_notes("MCP server")
    assert len(results) > 0
    # The MCP-related note should be most relevant
    assert "MCP" in results[0]["metadata"]["subject"]


def test_search_by_person():
    results = search_by_person("Habib")
    assert len(results) > 0
    for r in results:
        assert "Habib" in r["metadata"]["attendees"]


def test_find_connections_by_topic():
    results = find_connections_by_topic("data integration")
    assert len(results) > 0


def test_find_connections_by_note():
    # Get first note's ID
    results = search_notes("MCP", n_results=1)
    note_id = results[0]["id"]
    related = find_connections(note_id, n_results=5)
    assert len(related) > 0
    # Should not include the original note
    assert all(r["id"] != note_id for r in related)


def test_search_by_date_range():
    results = search_by_date_range("2026-03-10", "2026-03-12")
    assert len(results) >= 2
    for r in results:
        assert r["metadata"]["date"] >= "2026-03-10"
        assert r["metadata"]["date"] <= "2026-03-13"


def test_search_by_date_range_with_query():
    results = search_by_date_range("2026-03-10", "2026-03-14", query="MCP server")
    assert len(results) > 0
    assert "MCP" in results[0]["metadata"]["subject"]


def test_search_by_date_range_end_of_day():
    """Notes on the end_date should be included even when end_date has no time."""
    results = search_by_date_range("2026-03-14", "2026-03-14")
    assert len(results) >= 1
    assert any("Data DNA" in r["metadata"]["subject"] for r in results)
