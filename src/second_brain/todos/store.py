"""CRUD operations for todo items using ChromaDB."""

import chromadb

from ..config import TODO_COLLECTION_NAME
from ..storage.vector_store import get_client
from .models import TodoItem

_collection: chromadb.Collection | None = None


def get_collection() -> chromadb.Collection:
    global _collection
    if _collection is None:
        _collection = get_client().get_or_create_collection(
            name=TODO_COLLECTION_NAME,
            metadata={"hnsw:space": "cosine"},
        )
    return _collection


def add_todo(text: str) -> TodoItem:
    """Add a new todo item. Returns the created TodoItem."""
    todo = TodoItem(text=text)
    col = get_collection()
    col.add(
        ids=[todo.id],
        documents=[todo.to_document()],
        metadatas=[todo.metadata()],
    )
    return todo


def complete_todo(todo_id: str) -> bool:
    """Mark a todo item as done. Returns True if found and updated."""
    col = get_collection()
    result = col.get(ids=[todo_id], include=["documents", "metadatas"])
    if not result["ids"]:
        return False
    meta = result["metadatas"][0]
    meta["status"] = "done"
    col.update(ids=[todo_id], metadatas=[meta])
    return True


def edit_todo(todo_id: str, text: str) -> bool:
    """Update the text of a todo item. Returns True if found and updated."""
    col = get_collection()
    result = col.get(ids=[todo_id], include=["documents", "metadatas"])
    if not result["ids"]:
        return False
    meta = result["metadatas"][0]
    meta["text"] = text
    col.update(ids=[todo_id], documents=[text], metadatas=[meta])
    return True


def delete_todo(todo_id: str) -> bool:
    """Permanently delete a todo item. Returns True if deleted."""
    col = get_collection()
    result = col.get(ids=[todo_id])
    if not result["ids"]:
        return False
    col.delete(ids=[todo_id])
    return True


def list_todos(include_done: bool = False) -> list[TodoItem]:
    """List todo items. By default returns only pending items."""
    col = get_collection()
    if col.count() == 0:
        return []
    where = None if include_done else {"status": {"$eq": "pending"}}
    kwargs: dict = {"include": ["documents", "metadatas"]}
    if where:
        kwargs["where"] = where
    result = col.get(**kwargs)
    todos = []
    for i in range(len(result["ids"])):
        meta = result["metadatas"][i]
        from datetime import datetime
        todos.append(TodoItem(
            id=result["ids"][i],
            text=meta["text"],
            status=meta["status"],
            created_at=datetime.fromisoformat(meta["created_at"]),
        ))
    todos.sort(key=lambda t: t.created_at)
    return todos
