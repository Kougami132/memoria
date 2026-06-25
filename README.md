# Memoria

Personal knowledge base assistant powered by RAG.

## Installation

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
cp .env.example .env
# Edit .env and fill in NEWAPI_BASE_URL and NEWAPI_API_KEY
```

## CLI Usage

```
$ memoria --help
Usage: memoria [OPTIONS] COMMAND [ARGS]...

  Memoria — Personal Knowledge Base Assistant.

Commands:
  bot     Bot management.
  ingest  Ingest a file or directory into a knowledge base.
  kb      Knowledge base management.
  query   Query a bot.
  serve   Start the Memoria API server.
```

## Development

```bash
pytest          # Run tests
ruff check .    # Lint
black .         # Format
```
