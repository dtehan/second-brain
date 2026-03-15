"""Second Brain MCP Server — exposes meeting note tools."""

from mcp.server.fastmcp import FastMCP

from .notes import store
from .search import semantic, connections
from .storage import vector_store

mcp = FastMCP("Second Brain")


# ── Note Management ──────────────────────────────────────────────────────────


@mcp.tool()
def add_note(
    attendees: list[str],
    date: str,
    subject: str,
    content: str,
) -> str:
    """Add a meeting note with structured fields.

    Args:
        attendees: List of people in the meeting
        date: Meeting date in ISO format (e.g. "2026-03-15T10:00:00")
        subject: Meeting subject
        content: Bullet-point meeting notes
    """
    note = store.add_note(attendees, date, subject, content)
    return f"Note added (id: {note.id}): {subject} with {', '.join(note.attendees)}"


@mcp.tool()
def import_notes(text: str) -> str:
    """Bulk import meeting notes from OneNote export format.

    The text should contain meetings separated by lines of dashes (---...).
    Each meeting block has: attendees line, date line, RE: subject line, then bullet notes.

    Args:
        text: Raw OneNote export text containing one or more meetings
    """
    notes = store.import_notes(text)
    if not notes:
        return "No meetings found in the provided text."
    subjects = [f"- {n.subject} ({n.date.strftime('%m/%d/%y')})" for n in notes]
    return f"Imported {len(notes)} meeting(s):\n" + "\n".join(subjects)


@mcp.tool()
def get_note(note_id: str) -> str:
    """Retrieve a specific note by its ID.

    Args:
        note_id: The unique identifier of the note
    """
    result = store.get_note(note_id)
    if not result:
        return f"Note {note_id} not found."
    meta = result["metadata"]
    return (
        f"**{meta['subject']}**\n"
        f"Date: {meta['date']}\n"
        f"Attendees: {meta['attendees']}\n\n"
        f"{result['document']}"
    )


@mcp.tool()
def list_notes(limit: int = 50, offset: int = 0) -> str:
    """List stored meeting notes.

    Args:
        limit: Maximum number of notes to return (default 50)
        offset: Number of notes to skip (for pagination)
    """
    notes = store.list_notes(limit=limit, offset=offset)
    total = vector_store.count()
    if not notes:
        return "No notes stored yet."
    lines = []
    for n in notes:
        meta = n["metadata"]
        prefix = "[Email] " if meta.get("source", "").startswith("email_") else \
                 "[Chat] " if meta.get("source") == "teams_chat" else ""
        lines.append(f"- [{n['id'][:8]}] {prefix}{meta['subject']} ({meta['date'][:10]}) — {meta['attendees']}")
    return f"Showing {len(notes)} of {total} notes:\n" + "\n".join(lines)


@mcp.tool()
def delete_note(note_id: str) -> str:
    """Delete a note by its ID.

    Args:
        note_id: The unique identifier of the note to delete
    """
    if store.delete_note(note_id):
        return f"Note {note_id} deleted."
    return f"Note {note_id} not found."


# ── Email Ingestion ──────────────────────────────────────────────────────────


@mcp.tool()
def add_email_note(
    participants: list[str],
    date: str,
    subject: str,
    content: str,
    conversation_id: str | None = None,
    email_message_id: str | None = None,
    folder: str = "done",
) -> str:
    """Store an Outlook email thread as a note.

    Orchestration flow:
    1. Call list_processed_ids("email") to get already-stored conversation IDs
    2. Fetch emails via M365 outlook_email_search, skipping known IDs
    3. Summarize each thread, then call this tool to store it

    Args:
        participants: List of people on the email thread
        date: Email date in ISO format (e.g. "2026-03-15")
        subject: Email subject line
        content: Summarized email thread content
        conversation_id: Outlook conversation thread ID for deduplication
        email_message_id: Latest message ID in the thread
        folder: Source folder — "done" or "sent" (default "done")
    """
    note, message = store.add_email_note(
        participants=participants,
        date=date,
        subject=subject,
        content=content,
        conversation_id=conversation_id,
        email_message_id=email_message_id,
        folder=folder,
    )
    return message


@mcp.tool()
def list_processed_ids(source_type: str = "all") -> str:
    """List IDs of already-processed emails and chats to avoid re-ingesting duplicates.

    Call this BEFORE fetching from M365 to know what to skip.

    Args:
        source_type: "email", "chat", or "all" (default "all")
    """
    result = store.get_processed_ids(source_type)
    lines = []
    for key, ids in result.items():
        if ids:
            lines.append(f"**{key}** ({len(ids)} processed):")
            for id_ in ids:
                lines.append(f"  - {id_}")
        else:
            lines.append(f"**{key}**: none processed")
    return "\n".join(lines) if lines else "No processed IDs found."


# ── Chat Ingestion ───────────────────────────────────────────────────────────


@mcp.tool()
def suggest_subject(
    participants: list[str],
    topic_hint: str,
    n_results: int = 5,
) -> str:
    """Suggest existing note subjects that match a chat conversation's participants and topic.

    Call this before add_chat_note to find the best subject for a Teams chat.
    Returns existing notes ranked by participant overlap and topic relevance.

    Args:
        participants: List of people in the chat conversation
        topic_hint: Brief description of the chat topic
        n_results: Number of suggestions to return (default 5)
    """
    results = semantic.suggest_subject(participants, topic_hint, n_results=n_results)
    if not results:
        return "No matching notes found. Consider creating a new subject."
    lines = []
    for r in results:
        meta = r["metadata"]
        lines.append(
            f"- **{meta['subject']}** ({meta['date'][:10]}) — {meta['attendees']}"
        )
    return "Suggested subjects based on participant overlap and topic relevance:\n" + "\n".join(lines)


@mcp.tool()
def add_chat_note(
    participants: list[str],
    date: str,
    subject: str,
    content: str,
    chat_id: str | None = None,
    message_count: int | None = None,
) -> str:
    """Store a Teams chat conversation as a note.

    Claude calls this after fetching and formatting chat messages via M365.
    The note is stored with source="teams_chat" and appears in all search/analysis tools.

    Args:
        participants: List of people in the chat
        date: Chat date in ISO format (e.g. "2026-03-15")
        subject: Subject for the chat (use suggest_subject to find a matching one)
        content: Formatted chat messages
        chat_id: Optional Teams chat/thread ID for deduplication
        message_count: Optional number of messages in the conversation
    """
    note, message = store.add_chat_note(
        participants=participants,
        date=date,
        subject=subject,
        content=content,
        chat_id=chat_id,
        message_count=message_count,
    )
    return message


# ── Search & Discovery ───────────────────────────────────────────────────────


@mcp.tool()
def search_notes(query: str, n_results: int = 10) -> str:
    """Semantic search across all meeting notes. Returns the most relevant notes.

    Args:
        query: Natural language search query
        n_results: Number of results to return (default 10)
    """
    results = semantic.search_notes(query, n_results=n_results)
    if not results:
        return "No matching notes found."
    return _format_search_results(results)


@mcp.tool()
def search_by_person(person: str, query: str | None = None, n_results: int = 10) -> str:
    """Find all notes involving a specific person.

    Args:
        person: Person's name to search for
        query: Optional semantic query to narrow results
        n_results: Number of results to return (default 10)
    """
    results = semantic.search_by_person(person, query=query, n_results=n_results)
    if not results:
        return f"No notes found involving {person}."
    return _format_search_results(results)


@mcp.tool()
def search_by_date_range(
    start_date: str,
    end_date: str,
    query: str | None = None,
    n_results: int = 10,
) -> str:
    """Find notes within a date range.

    Args:
        start_date: Start date in ISO format (e.g. "2026-01-01")
        end_date: End date in ISO format (e.g. "2026-03-15")
        query: Optional semantic query to narrow results
        n_results: Number of results to return (default 10)
    """
    results = semantic.search_by_date_range(start_date, end_date, query=query, n_results=n_results)
    if not results:
        return "No notes found in that date range."
    return _format_search_results(results)


@mcp.tool()
def find_connections(note_id: str | None = None, topic: str | None = None, n_results: int = 10) -> str:
    """Find semantically related notes. Provide either a note_id or a topic.

    Args:
        note_id: ID of a note to find connections for
        topic: Topic string to find related notes about
        n_results: Number of results to return (default 10)
    """
    if note_id:
        results = connections.find_connections(note_id, n_results=n_results)
    elif topic:
        results = connections.find_connections_by_topic(topic, n_results=n_results)
    else:
        return "Please provide either a note_id or a topic."
    if not results:
        return "No related notes found."
    return _format_search_results(results)


# ── Analysis ─────────────────────────────────────────────────────────────────


@mcp.tool()
def summarize_topic(topic: str, n_results: int = 15) -> str:
    """Retrieve all notes related to a topic for summarization.

    Returns the content of all matching notes so the LLM client can summarize.

    Args:
        topic: The topic to summarize across meetings
        n_results: Number of notes to consider (default 15)
    """
    results = semantic.search_notes(topic, n_results=n_results)
    if not results:
        return f"No notes found about '{topic}'."
    sections = []
    for r in results:
        meta = r["metadata"]
        sections.append(
            f"### {meta['subject']} ({meta['date'][:10]})\n"
            f"Attendees: {meta['attendees']}\n\n"
            f"{r['document']}"
        )
    return (
        f"Found {len(results)} notes about '{topic}'. "
        "Please summarize the key points across these meetings:\n\n"
        + "\n\n---\n\n".join(sections)
    )


@mcp.tool()
def summarize_person(person: str, n_results: int = 15) -> str:
    """Retrieve all notes involving a person for summarization.

    Returns the content of matching notes so the LLM client can summarize.

    Args:
        person: The person's name
        n_results: Number of notes to consider (default 15)
    """
    results = semantic.search_by_person(person, n_results=n_results)
    if not results:
        return f"No notes found involving {person}."
    sections = []
    for r in results:
        meta = r["metadata"]
        sections.append(
            f"### {meta['subject']} ({meta['date'][:10]})\n"
            f"Attendees: {meta['attendees']}\n\n"
            f"{r['document']}"
        )
    return (
        f"Found {len(results)} notes involving {person}. "
        "Please summarize key interactions and topics:\n\n"
        + "\n\n---\n\n".join(sections)
    )


@mcp.tool()
def list_topics(n_sample: int = 50) -> str:
    """List the subjects of all stored meetings to show topic coverage.

    Args:
        n_sample: Number of notes to sample (default 50)
    """
    notes = vector_store.list_notes(limit=n_sample)
    if not notes:
        return "No notes stored yet."
    subjects = {}
    for n in notes:
        subj = n["metadata"]["subject"]
        subjects[subj] = subjects.get(subj, 0) + 1
    lines = [f"- {subj} ({count}x)" if count > 1 else f"- {subj}" for subj, count in sorted(subjects.items())]
    return f"Topics across {len(notes)} notes:\n" + "\n".join(lines)


# ── Helpers ──────────────────────────────────────────────────────────────────


def _format_search_results(results: list[dict]) -> str:
    """Format search results for display."""
    lines = []
    for r in results:
        meta = r["metadata"]
        distance = r.get("distance")
        score = f" (relevance: {1 - distance:.2f})" if distance is not None else ""
        prefix = "[Email] " if meta.get("source", "").startswith("email_") else \
                 "[Chat] " if meta.get("source") == "teams_chat" else ""
        lines.append(
            f"### {prefix}{meta['subject']} ({meta['date'][:10]}){score}\n"
            f"ID: {r['id']}\n"
            f"Attendees: {meta['attendees']}\n\n"
            f"{r['document']}\n"
        )
    return "\n---\n\n".join(lines)


def main():
    mcp.run()


if __name__ == "__main__":
    main()
