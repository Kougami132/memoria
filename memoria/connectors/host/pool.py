import logging
import threading
import time
from typing import Optional

logger = logging.getLogger(__name__)

IDLE_TIMEOUT_SECONDS = 300.0  # 5 minutes


class SSHConnectionPool:
    """Connection pool with idle expiration and thread safety."""

    def __init__(self, idle_timeout: float = IDLE_TIMEOUT_SECONDS):
        self.idle_timeout = idle_timeout
        self._pool: dict[str, tuple[any, float]] = {}  # host_id -> (client, last_accessed)
        self._lock = threading.Lock()

    def get_client(self, host_id: str, connector: any) -> any:
        with self._lock:
            self._cleanup_expired()
            if host_id in self._pool:
                client, _ = self._pool[host_id]
                # Check if client transport is alive
                transport = client.get_transport() if hasattr(client, "get_transport") else None
                if transport and transport.is_active():
                    self._pool[host_id] = (client, time.time())
                    return client
                else:
                    try:
                        client.close()
                    except Exception:
                        pass
                    del self._pool[host_id]

            # Connect new client
            client = connector._create_ssh_client()
            self._pool[host_id] = (client, time.time())
            return client

    def invalidate(self, host_id: str) -> None:
        with self._lock:
            if host_id in self._pool:
                client, _ = self._pool.pop(host_id)
                try:
                    client.close()
                except Exception:
                    pass

    def close_all(self) -> None:
        with self._lock:
            for host_id, (client, _) in list(self._pool.items()):
                try:
                    client.close()
                except Exception:
                    pass
            self._pool.clear()

    def _cleanup_expired(self) -> None:
        now = time.time()
        expired = [
            hid for hid, (_, last_t) in self._pool.items()
            if now - last_t > self.idle_timeout
        ]
        for hid in expired:
            client, _ = self._pool.pop(hid, (None, None))
            if client:
                try:
                    client.close()
                except Exception:
                    pass
