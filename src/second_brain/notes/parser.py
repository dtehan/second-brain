"""Parse OneNote export format into MeetingNote objects."""

import re
from datetime import datetime

from .models import MeetingNote

SEPARATOR = re.compile(r"^-{10,}\s*$")
DATE_PATTERN = re.compile(
    r"^.*?at\s+(\d{1,2}/\d{1,2}/\d{2,4}\s+\d{1,2}:\d{2}\s*[APap][Mm])",
    re.IGNORECASE,
)
SUBJECT_PATTERN = re.compile(r"^RE:\s*(.+)", re.IGNORECASE)


def parse_onenote_export(text: str) -> list[MeetingNote]:
    """Parse a full OneNote export containing multiple meetings separated by dashes."""
    blocks = _split_blocks(text)
    notes = []
    for block in blocks:
        note = _parse_block(block)
        if note:
            notes.append(note)
    return notes


def _split_blocks(text: str) -> list[str]:
    """Split text into meeting blocks using dash separators."""
    lines = text.split("\n")
    blocks: list[str] = []
    current: list[str] = []

    for line in lines:
        if SEPARATOR.match(line):
            if current:
                blocks.append("\n".join(current))
                current = []
        else:
            current.append(line)

    if current:
        joined = "\n".join(current).strip()
        if joined:
            blocks.append(joined)

    return blocks


def _parse_block(block: str) -> MeetingNote | None:
    """Parse a single meeting block into a MeetingNote."""
    lines = block.strip().split("\n")
    if not lines:
        return None

    attendees: list[str] = []
    date: datetime | None = None
    subject: str = ""
    content_lines: list[str] = []
    parsing_content = False

    for line in lines:
        stripped = line.strip()
        if not stripped:
            if parsing_content:
                content_lines.append("")
            continue

        if parsing_content:
            content_lines.append(line)
            continue

        # Try to match date line
        date_match = DATE_PATTERN.match(stripped)
        if date_match and date is None:
            date = _parse_date(date_match.group(1))
            continue

        # Try to match subject line
        subject_match = SUBJECT_PATTERN.match(stripped)
        if subject_match and not subject:
            subject = subject_match.group(1).strip()
            parsing_content = True
            continue

        # If we haven't found date/subject yet, this is likely the attendees line
        if date is None and not subject:
            attendees = _parse_attendees(stripped)

    if not date and not subject and not content_lines:
        return None

    content = "\n".join(content_lines).strip()

    return MeetingNote(
        attendees=attendees,
        date=date or datetime.now(),
        subject=subject or "Untitled Meeting",
        content=content,
        source="onenote_import",
    )


def _parse_attendees(line: str) -> list[str]:
    """Parse comma-separated attendee names."""
    # Split on semicolons or commas, but keep "Last, First" together
    # Heuristic: if we see "word, word;" treat semicolons as separators
    if ";" in line:
        parts = line.split(";")
    else:
        # Try to detect "Last, First" patterns vs simple comma separation
        # If the line has names like "Tehan, Daniel, Smith, John" we pair them
        parts = [p.strip() for p in line.split(",")]
        if len(parts) >= 2 and all(len(p.split()) <= 2 for p in parts):
            # Could be "Last, First, Last, First" — try pairing
            if len(parts) % 2 == 0 and len(parts) > 2:
                paired = [
                    f"{parts[i]}, {parts[i+1]}"
                    for i in range(0, len(parts), 2)
                ]
                return [p.strip() for p in paired if p.strip()]
            # Otherwise just return as-is
            return [p.strip() for p in parts if p.strip()]

    return [p.strip() for p in parts if p.strip()]


def _parse_date(date_str: str) -> datetime | None:
    """Parse date string in common formats."""
    formats = [
        "%m/%d/%y %I:%M %p",
        "%m/%d/%Y %I:%M %p",
        "%m/%d/%y %I:%M%p",
        "%m/%d/%Y %I:%M%p",
    ]
    cleaned = date_str.strip()
    for fmt in formats:
        try:
            return datetime.strptime(cleaned, fmt)
        except ValueError:
            continue
    return None
