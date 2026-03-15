"""ChromaDB operations for meeting notes."""

import chromadb

from ..config import CHROMA_PERSIST_DIR, COLLECTION_NAME
from ..notes.models import MeetingNote
from ..embeddings.embedder import embed_text, embed_texts

_client: chromadb.ClientAPI | None = None
_collection: chromadb.Collection | None = None


def get_collection() -> chromadb.Collection:
    global _client, _collection
    if _collection is None:
        _client = chromadb.PersistentClient(path=CHROMA_PERSIST_DIR)
        _collection = _client.get_or_create_collection(
            name=COLLECTION_NAME,
            metadata={"hnsw:space": "cosine"},
        )
    return _collection


def add_note(note: MeetingNote) -> str:
    """Add a single note to the vector store. Returns the note ID."""
    collection = get_collection()
    embedding = embed_text(note.to_document())
    collection.add(
        ids=[note.id],
        embeddings=[embedding],
        documents=[note.to_document()],
        metadatas=[note.metadata()],
    )
    return note.id


def add_notes(notes: list[MeetingNote]) -> list[str]:
    """Add multiple notes in a batch. Returns list of note IDs."""
    if not notes:
        return []
    collection = get_collection()
    documents = [n.to_document() for n in notes]
    embeddings = embed_texts(documents)
    collection.add(
        ids=[n.id for n in notes],
        embeddings=embeddings,
        documents=documents,
        metadatas=[n.metadata() for n in notes],
    )
    return [n.id for n in notes]


def get_note(note_id: str) -> dict | None:
    """Retrieve a note by ID."""
    collection = get_collection()
    result = collection.get(ids=[note_id], include=["documents", "metadatas"])
    if not result["ids"]:
        return None
    return {
        "id": result["ids"][0],
        "document": result["documents"][0],
        "metadata": result["metadatas"][0],
    }


def delete_note(note_id: str) -> bool:
    """Delete a note by ID. Returns True if deleted."""
    collection = get_collection()
    try:
        collection.delete(ids=[note_id])
        return True
    except Exception:
        return False


def search(
    query: str,
    n_results: int = 10,
    where: dict | None = None,
) -> list[dict]:
    """Semantic search with optional metadata filtering."""
    collection = get_collection()
    embedding = embed_text(query)
    kwargs = {
        "query_embeddings": [embedding],
        "n_results": min(n_results, collection.count() or 1),
        "include": ["documents", "metadatas", "distances"],
    }
    if where:
        kwargs["where"] = where
    if collection.count() == 0:
        return []
    result = collection.query(**kwargs)
    results = []
    for i in range(len(result["ids"][0])):
        results.append({
            "id": result["ids"][0][i],
            "document": result["documents"][0][i],
            "metadata": result["metadatas"][0][i],
            "distance": result["distances"][0][i],
        })
    return results


def list_notes(
    where: dict | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """List notes with optional filtering."""
    collection = get_collection()
    kwargs = {
        "include": ["documents", "metadatas"],
        "limit": limit,
        "offset": offset,
    }
    if where:
        kwargs["where"] = where
    result = collection.get(**kwargs)
    results = []
    for i in range(len(result["ids"])):
        results.append({
            "id": result["ids"][i],
            "document": result["documents"][i],
            "metadata": result["metadatas"][i],
        })
    return results


def count() -> int:
    """Return total number of notes."""
    return get_collection().count()
