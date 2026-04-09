from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent.parent
CHROMA_PERSIST_DIR = str(PROJECT_ROOT / "data" / "chroma")
EMBEDDING_MODEL = "all-MiniLM-L6-v2"
COLLECTION_NAME = "meeting_notes"
TODO_COLLECTION_NAME = "todos"
TOP_K_RESULTS = 10
