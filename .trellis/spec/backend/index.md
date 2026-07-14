# Backend Development Guidelines

> Best practices for backend development in this project.

---

## Overview

The backend is a Python `memoria/` package (Python 3.11+) using FastAPI, SQLAlchemy 2.0 (SQLite), ChromaDB for vector storage, OpenAI-compatible clients for embeddings and chat, and APScheduler for background vault polling. These guidelines document the actual conventions enforced in this codebase.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | Filled |
| [Database Guidelines](./database-guidelines.md) | ORM patterns, queries, migrations | Filled |
| [Error Handling](./error-handling.md) | Error types, handling strategies | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | Filled |
| [Logging Guidelines](./logging-guidelines.md) | Structured logging, log levels | Filled |

---

## How to Use These Guidelines

For each guideline file:

1. Read the conventions before writing code in that area.
2. Follow the code examples drawn from the actual codebase.
3. Avoid listed forbidden patterns and common mistakes.
4. When in doubt, match the closest existing module rather than inventing a new style.

The goal is to help AI assistants and new team members understand how THIS project works.

---

## Pre-Development Checklist

Before writing backend code, check:

1. Which layer does the change belong to? (routes, core, storage, vault, llm, models)
2. Does it need a new DB column or table? If so, add a migration block in `DB.__init__` and a `DEFAULT` value.
3. Does it call the OpenAI API directly? Route it through `Pipeline` instead so mock mode stays intact.
4. Are you returning ORM objects or dicts? Dicts only.
5. Are exceptions caught and mapped to HTTP status codes? `ValueError` -> 404, `APIConnectionError` -> 503, `APIError`/`RuntimeError` -> 502.
6. Is the logger using `__name__` and `%`-style args?
7. Is `webdav_password` excluded from any new vault-related response?

---

## Capability Specifications

The system's functional requirements are defined by capability areas. When a task references a capability, check `.trellis/spec/guides/memoria-domain-guide.md` for the domain checklist, then follow the coding conventions in this directory for implementation.

---

**Language**: All documentation should be written in **English**.
