"""Task 1: verify vault dependencies are importable."""
import importlib


def test_webdavclient3_importable():
    mod = importlib.import_module("webdav3.client")
    assert hasattr(mod, "Client")


def test_apscheduler_asyncio_importable():
    mod = importlib.import_module("apscheduler.schedulers.asyncio")
    assert hasattr(mod, "AsyncIOScheduler")


def test_vault_package_importable():
    importlib.import_module("memoria.vault")
