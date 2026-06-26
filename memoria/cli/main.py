from typing import Optional

import click
import uvicorn

from memoria.server.deps import get_db, get_pipeline


@click.group()
def cli() -> None:
    """Memoria — Personal Knowledge Base Assistant."""


@cli.command()
@click.option("--host", default="0.0.0.0", show_default=True)
@click.option("--port", default=8000, show_default=True)
def serve(host: str, port: int) -> None:
    """Start the Memoria API server."""
    uvicorn.run("memoria.server.app:app", host=host, port=port, reload=False)


@cli.group()
def kb() -> None:
    """Knowledge base management."""


@kb.command("create")
@click.argument("name")
@click.option("--description", default="")
def kb_create(name: str, description: str) -> None:
    """Create a new knowledge base."""
    result = get_db().create_kb(name, description)
    click.echo(f"Created KB: {result['id']} — {result['name']}")


@kb.command("list")
def kb_list() -> None:
    """List all knowledge bases."""
    kbs = get_db().list_kbs()
    if not kbs:
        click.echo("No knowledge bases found.")
        return
    for k in kbs:
        click.echo(f"{k['id']}  {k['name']}  {k['description']}")


@kb.command("delete")
@click.argument("kb_id")
def kb_delete(kb_id: str) -> None:
    """Delete a knowledge base."""
    get_db().delete_kb(kb_id)
    click.echo(f"Deleted KB: {kb_id}")


@cli.group()
def bot() -> None:
    """Bot management."""


@bot.command("create")
@click.argument("name")
@click.option("--system-prompt", default="")
def bot_create(name: str, system_prompt: str) -> None:
    """Create a new bot."""
    result = get_db().create_bot(name, system_prompt)
    click.echo(f"Created Bot: {result['id']} — {result['name']}")


@bot.command("list")
def bot_list() -> None:
    """List all bots."""
    bots = get_db().list_bots()
    if not bots:
        click.echo("No bots found.")
        return
    for b in bots:
        click.echo(f"{b['id']}  {b['name']}  kbs={b['kb_ids']}")


@bot.command("delete")
@click.argument("bot_id")
def bot_delete(bot_id: str) -> None:
    """Delete a bot."""
    get_db().delete_bot(bot_id)
    click.echo(f"Deleted Bot: {bot_id}")


@cli.command()
@click.argument("kb_id")
@click.argument("path")
def ingest(kb_id: str, path: str) -> None:
    """Ingest a file into a knowledge base."""
    result = get_pipeline().ingest(kb_id, path)
    click.echo(f"Ingested: {result['chunk_count']} chunks")


@cli.command()
@click.argument("bot_id")
@click.argument("question")
@click.option("--session-id", default=None)
def query(bot_id: str, question: str, session_id: Optional[str]) -> None:
    """Query a bot."""
    result = get_pipeline().query(bot_id, question, session_id)
    click.echo(result["answer"])
    click.echo(f"[session_id: {result['session_id']}]")
