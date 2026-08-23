# Design: Host Connector Security, Connection Pool, and UI Management

## 1. Credential Encryption (`memoria/connectors/crypto.py` / `memoria/config.py`)
- Key derivation from secret key in `Settings` (e.g. SHA-256 derived Fernet / AES token).
- `encrypt_secret(plaintext: str) -> str` and `decrypt_secret(ciphertext: str) -> str`.
- Passwords and private keys stored in `hosts.config` are encrypted before writing to SQLite and decrypted when initializing `HostConfig`.
- When exporting via REST API `/api/hosts`, secrets are masked (e.g. `******` or omitted).

## 2. Command Safety Guardrails (`memoria/connectors/host/guard.py`)
- **Dangerous Command Patterns (Blacklist)**:
  - Recursive roots: `rm -rf /`, `rm -fr /`, `rm -rf /*`
  - Raw filesystem ops: `mkfs`, `fdisk`, `dd if=`, `format`
  - System reboot/shutdown: `reboot`, `shutdown`, `poweroff`, `init 0`
  - Destructive redirection: `> /dev/sda`
- **Execution Safeguards**:
  - `timeout_seconds`: default 15s per command execution.
  - `max_output_length`: default 8,000 chars (truncated with warning when exceeded to protect token context).
  - `safe_mode` / `read_only` flag on Host: when enabled, blocks mutating commands.

## 3. SSH Connection Pool (`memoria/connectors/host/pool.py`)
- Class `SSHConnectionPool`:
  - Internal dictionary: `_connections: dict[str, tuple[paramiko.SSHClient, float]]` (client, last_accessed_timestamp).
  - Method `get_connection(host_id: str, config: HostConfig) -> paramiko.SSHClient`:
    - Checks if active client exists and is alive (`get_transport().is_active()`).
    - If valid, updates `last_accessed` and returns.
    - If dead or expired (> 300s), closes old and opens new.
  - Method `close(host_id: str)` and `close_all()`.

## 4. Frontend Implementation (`web/src/`)
- **API (`web/src/api.ts`)**:
  - `getHosts()`, `createHost()`, `updateHost()`, `deleteHost()`, `testHostConnection()`.
- **Pages / Components**:
  - `web/src/pages/HostsPage.tsx`:
    - Host list table/cards with status indicator (Online / Offline / Testing badge).
    - Add/Edit Host Dialog (Name, Host, Port, Username, Auth Type: Password / Private Key, Safe Mode toggle).
    - Test connection button with instant ping/status feedback.
  - Navigation: Add "主机管理 (Hosts)" item with Server icon in sidebar navigation.
  - Bot Dialog update:
    - Add "关联主机" Multi-select component, passing `host_ids` on Bot create/update.
