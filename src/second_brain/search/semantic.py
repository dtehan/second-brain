"""Semantic search operations."""

from ..storage import vector_store
from ..config import TOP_K_RESULTS


def search_notes(query: str, n_results: int = TOP_K_RESULTS) -> list[dict]:
    """Full semantic search across all notes."""
    return vector_store.search(query, n_results=n_results)


def search_by_person(person: str, query: str | None = None, n_results: int = TOP_K_RESULTS) -> list[dict]:
    """Find notes involving a specific person.

    Searches for the person name in attendees metadata using substring matching,
    then optionally filters by semantic relevance if a query is provided.
    """
    search_query = query or person
    # Fetch more results than needed so we can filter
    candidates = vector_store.search(search_query, n_results=n_results * 3)
    person_lower = person.lower()
    filtered = [r for r in candidates if person_lower in r["metadata"]["attendees"].lower()]

    if not filtered:
        # Fallback: list all notes and filter
        all_notes = vector_store.list_notes(limit=500)
        filtered = [n for n in all_notes if person_lower in n["metadata"]["attendees"].lower()]

    return filtered[:n_results]


def suggest_subject(
    participants: list[str],
    topic_hint: str,
    n_results: int = 5,
) -> list[dict]:
    """Find existing notes that match a topic and share participants.

    Returns results sorted by participant overlap (descending), so Claude
    can pick the best subject for a chat note or create a new one.
    """
    candidates = vector_store.search(topic_hint, n_results=n_results * 3)
    participants_lower = {p.lower() for p in participants}

    def overlap_score(result: dict) -> int:
        attendees = {a.strip().lower() for a in result["metadata"]["attendees"].split(",")}
        return len(participants_lower & attendees)

    # Score and sort by overlap descending, then by semantic distance ascending
    scored = []
    for r in candidates:
        overlap = overlap_score(r)
        scored.append((overlap, r.get("distance", 1.0), r))

    scored.sort(key=lambda x: (-x[0], x[1]))
    return [item[2] for item in scored[:n_results]]


def search_by_date_range(
    start_date: str,
    end_date: str,
    query: str | None = None,
    n_results: int = TOP_K_RESULTS,
) -> list[dict]:
    """Find notes within a date range (ISO format strings).

    If query is provided, also performs semantic search within those results.
    """
    where = {
        "$and": [
            {"date": {"$gte": start_date}},
            {"date": {"$lte": end_date}},
        ]
    }
    if query:
        return vector_store.search(query, n_results=n_results, where=where)
    return vector_store.list_notes(where=where, limit=n_results)
