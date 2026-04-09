"""Migration: add date_ts (epoch timestamp) to existing notes in ChromaDB."""

from datetime import datetime
from .storage import vector_store


def migrate_add_date_ts():
    """Read all notes and add date_ts metadata where missing."""
    collection = vector_store.get_collection()
    total = collection.count()
    if total == 0:
        print("No notes found — nothing to migrate.")
        return

    # Fetch all notes
    result = collection.get(include=["metadatas"])
    updated = 0
    ids_to_update = []
    metadatas_to_update = []

    for i, note_id in enumerate(result["ids"]):
        meta = result["metadatas"][i]
        if "date_ts" in meta:
            continue
        date_str = meta.get("date")
        if not date_str:
            continue
        meta["date_ts"] = datetime.fromisoformat(date_str).timestamp()
        ids_to_update.append(note_id)
        metadatas_to_update.append(meta)
        updated += 1

    if ids_to_update:
        collection.update(ids=ids_to_update, metadatas=metadatas_to_update)

    print(f"Migrated {updated}/{total} notes (added date_ts).")


if __name__ == "__main__":
    migrate_add_date_ts()
