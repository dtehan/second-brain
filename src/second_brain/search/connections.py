"""Find connections between notes."""

from ..storage import vector_store
from ..config import TOP_K_RESULTS


def find_connections(note_id: str, n_results: int = TOP_K_RESULTS) -> list[dict]:
    """Given a note ID, find semantically related notes."""
    note = vector_store.get_note(note_id)
    if not note:
        return []
    # Search using the note's content, exclude the note itself
    results = vector_store.search(note["document"], n_results=n_results + 1)
    return [r for r in results if r["id"] != note_id][:n_results]


def find_connections_by_topic(topic: str, n_results: int = TOP_K_RESULTS) -> list[dict]:
    """Find notes related to a topic."""
    return vector_store.search(topic, n_results=n_results)
