# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Second Brain — an MCP server for storing, searching, and discovering connections across meeting notes using AI-powered semantic search.

## Tech Stack

- **Python** with `mcp` SDK (FastMCP)
- **ChromaDB** for vector storage
- **sentence-transformers** (all-MiniLM-L6-v2) for local embeddings
- **stdio transport** for Claude Desktop integration

## Structure

- `src/second_brain/server.py` — MCP server with 12 tools
- `src/second_brain/notes/` — models, parser (OneNote format), CRUD store
- `src/second_brain/embeddings/` — sentence-transformers wrapper
- `src/second_brain/search/` — semantic search, person/date filtering, connections
- `src/second_brain/storage/` — ChromaDB operations
- `tests/` — parser, store, and search tests

## Commands

```bash
# Run tests
source .venv/bin/activate && python -m pytest tests/ -v

# Run MCP server (stdio)
source .venv/bin/activate && python -m second_brain.server
```

## Claude Desktop Configuration

Add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "second-brain": {
      "command": "/Users/Daniel.Tehan/Code/second-brain/.venv/bin/python",
      "args": ["-m", "second_brain.server"]
    }
  }
}
```
