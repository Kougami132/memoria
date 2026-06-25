import click


@click.group()
def cli() -> None:
    """Memoria — Personal Knowledge Base Assistant."""


@cli.command()
@click.option("--host", default="0.0.0.0", show_default=True)
@click.option("--port", default=8000, show_default=True)
def serve(host: str, port: int) -> None:
    """Start the Memoria API server."""
    raise NotImplementedError


@cli.group()
def kb() -> None:
    """Knowledge base management."""


@kb.command("create")
@click.argument("name")
def kb_create(name: str) -> None:
    """Create a new knowledge base."""
    raise NotImplementedError


@kb.command("list")
def kb_list() -> None:
    """List all knowledge bases."""
    raise NotImplementedError


@kb.command("delete")
@click.argument("kb_id")
def kb_delete(kb_id: str) -> None:
    """Delete a knowledge base."""
    raise NotImplementedError


@cli.group()
def bot() -> None:
    """Bot management."""


@bot.command("create")
@click.argument("name")
def bot_create(name: str) -> None:
    """Create a new bot."""
    raise NotImplementedError


@bot.command("list")
def bot_list() -> None:
    """List all bots."""
    raise NotImplementedError


@bot.command("delete")
@click.argument("bot_id")
def bot_delete(bot_id: str) -> None:
    """Delete a bot."""
    raise NotImplementedError


@cli.command()
@click.argument("kb_id")
@click.argument("path")
def ingest(kb_id: str, path: str) -> None:
    """Ingest a file or directory into a knowledge base."""
    raise NotImplementedError


@cli.command()
@click.argument("bot_id")
@click.argument("question")
def query(bot_id: str, question: str) -> None:
    """Query a bot."""
    raise NotImplementedError
