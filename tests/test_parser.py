"""Tests for the OneNote export parser."""

from second_brain.notes.parser import parse_onenote_export


SAMPLE_EXPORT = """
-----------------------------------------------------------
Tehan, Daniel, Habib, Ahmed
Tehan, Daniel at 3/10/26 10:00 AM
RE: Data DNA Weekly Sync
\t• Discussed MCP integration timeline
\t• Habib raised concerns about API rate limits
\t\t○ Need to implement backoff strategy
\t• Action item: Daniel to prototype MCP server
-----------------------------------------------------------
Smith, John, Tehan, Daniel
Tehan, Daniel at 3/12/26 2:30 PM
RE: Cigna MCP Demo Prep
\t• Two groups interested
\t\t○ Client analytics with Vince
\t\t○ DBA group focusing on SQL optimization
\t• Need to prepare demo environment by Friday
-----------------------------------------------------------
"""


def test_parse_multiple_meetings():
    notes = parse_onenote_export(SAMPLE_EXPORT)
    assert len(notes) == 2


def test_parse_attendees():
    notes = parse_onenote_export(SAMPLE_EXPORT)
    assert "Tehan, Daniel" in notes[0].attendees
    assert "Habib, Ahmed" in notes[0].attendees


def test_parse_subject():
    notes = parse_onenote_export(SAMPLE_EXPORT)
    assert notes[0].subject == "Data DNA Weekly Sync"
    assert notes[1].subject == "Cigna MCP Demo Prep"


def test_parse_date():
    notes = parse_onenote_export(SAMPLE_EXPORT)
    assert notes[0].date.month == 3
    assert notes[0].date.day == 10
    assert notes[0].date.year == 2026


def test_parse_content():
    notes = parse_onenote_export(SAMPLE_EXPORT)
    assert "MCP integration timeline" in notes[0].content
    assert "backoff strategy" in notes[0].content


def test_parse_source():
    notes = parse_onenote_export(SAMPLE_EXPORT)
    for note in notes:
        assert note.source == "onenote_import"


def test_parse_empty():
    notes = parse_onenote_export("")
    assert notes == []


def test_parse_single_meeting():
    text = """
-----------------------------------------------------------
Tehan, Daniel
Tehan, Daniel at 1/15/26 9:00 AM
RE: Quick Standup
\t• All tasks on track
-----------------------------------------------------------
"""
    notes = parse_onenote_export(text)
    assert len(notes) == 1
    assert notes[0].subject == "Quick Standup"
