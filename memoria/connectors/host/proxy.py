from __future__ import annotations

import logging
import socket
import urllib.parse

try:
    import socks
except ImportError:  # pragma: no cover
    socks = None  # type: ignore

logger = logging.getLogger(__name__)

SUPPORTED_SCHEMES = ("http", "https", "socks5", "socks5h")


class ProxyError(Exception):
    """Base exception for proxy errors."""


class ProxyServerUnreachableError(ProxyError):
    """Raised when connection to proxy server itself fails."""


class ProxyAuthError(ProxyError):
    """Raised when authentication to proxy server fails."""


class TargetUnreachableViaProxyError(ProxyError):
    """Raised when proxy is reached but target host cannot be reached through the proxy."""


def validate_proxy_url(url: str | None) -> str:
    """Validate and normalize a proxy URL.

    Supported schemes: http, https, socks5, socks5h.
    Assigns standard default ports (8080 for HTTP/HTTPS, 1080 for SOCKS5/SOCKS5H).
    Returns normalized proxy URL or empty string.
    """
    if not url or not url.strip():
        return ""

    raw = url.strip()
    parsed = urllib.parse.urlsplit(raw)
    scheme = parsed.scheme.lower()
    if scheme not in SUPPORTED_SCHEMES:
        raise ValueError(
            f"Unsupported proxy scheme '{parsed.scheme}'. Supported schemes: {', '.join(SUPPORTED_SCHEMES)}"
        )

    if not parsed.hostname:
        raise ValueError("Proxy URL must include a host")

    try:
        port = parsed.port
    except ValueError as exc:
        raise ValueError(f"Invalid proxy port: {exc}") from exc

    if port is None:
        port = 8080 if scheme in ("http", "https") else 1080
    elif port < 1 or port > 65535:
        raise ValueError(f"Invalid proxy port: {port}")

    netloc = ""
    if parsed.username is not None:
        netloc += parsed.username
        if parsed.password is not None:
            netloc += f":{parsed.password}"
        netloc += "@"

    host_str = (
        f"[{parsed.hostname}]"
        if ":" in parsed.hostname and not parsed.hostname.startswith("[")
        else parsed.hostname
    )
    netloc += f"{host_str}:{port}"

    path = parsed.path or ""
    query = f"?{parsed.query}" if parsed.query else ""
    fragment = f"#{parsed.fragment}" if parsed.fragment else ""
    return f"{scheme}://{netloc}{path}{query}{fragment}"


def mask_proxy_url(url: str | None) -> str:
    """Mask the password component in a proxy URL with '******'."""
    if not url or not url.strip():
        return ""

    raw = url.strip()
    parsed = urllib.parse.urlsplit(raw)
    if parsed.password is None:
        return raw

    userinfo, _, host_port = parsed.netloc.rpartition("@")
    user, _, _ = userinfo.partition(":")
    new_netloc = f"{user}:******@{host_port}"
    return urllib.parse.urlunsplit((parsed.scheme, new_netloc, parsed.path, parsed.query, parsed.fragment))


def merge_proxy_url(new_url: str | None, old_url: str | None) -> str:
    """Merge a submitted proxy URL with an existing one.

    If new_url is None: returns old_url.
    If new_url is empty: returns "" (clearing proxy).
    If new_url contains '******' as password: restores original password from old_url.
    Otherwise: returns new_url.
    """
    if new_url is None:
        return old_url or ""

    new_url = new_url.strip()
    if not new_url:
        return ""

    if not old_url:
        return new_url

    parsed_new = urllib.parse.urlsplit(new_url)
    if parsed_new.password == "******":
        parsed_old = urllib.parse.urlsplit(old_url.strip())
        if parsed_old.password:
            userinfo, _, host_port = parsed_new.netloc.rpartition("@")
            user, _, _ = userinfo.partition(":")
            old_userinfo, _, _ = parsed_old.netloc.rpartition("@")
            _, _, old_pass = old_userinfo.partition(":")
            new_netloc = f"{user}:{old_pass}@{host_port}"
            return urllib.parse.urlunsplit(
                (parsed_new.scheme, new_netloc, parsed_new.path, parsed_new.query, parsed_new.fragment)
            )

    return new_url


def create_proxy_socket(
    proxy_url: str,
    target_host: str,
    target_port: int,
    timeout: float = 5.0,
) -> socket.socket:
    """Create and connect a socksocket through the configured proxy to target_host:target_port.

    Enforces remote DNS resolution (rdns=True) for SOCKS5 proxies to avoid local DNS failures.
    Translates PySocks exceptions to structured domain errors.
    """
    if not proxy_url or not proxy_url.strip():
        raise ValueError("proxy_url cannot be empty")

    if socks is None:
        raise ProxyError("PySocks 未安装，无法建立代理隧道。请执行 'pip install PySocks'")

    parsed = urllib.parse.urlsplit(proxy_url.strip())
    scheme = parsed.scheme.lower()
    if scheme in ("http", "https"):
        proxy_type = socks.PROXY_TYPE_HTTP
        default_port = 8080
    elif scheme in ("socks5", "socks5h"):
        proxy_type = socks.PROXY_TYPE_SOCKS5
        default_port = 1080
    else:
        raise ValueError(f"Unsupported proxy scheme '{parsed.scheme}'")

    proxy_host = parsed.hostname
    if not proxy_host:
        raise ValueError("Proxy URL must include a host")

    proxy_port = parsed.port or default_port
    username = urllib.parse.unquote(parsed.username) if parsed.username is not None else None
    password = urllib.parse.unquote(parsed.password) if parsed.password is not None else None

    sock = socks.socksocket()
    sock.settimeout(timeout)
    sock.set_proxy(
        proxy_type=proxy_type,
        addr=proxy_host,
        port=proxy_port,
        rdns=True,
        username=username,
        password=password,
    )

    try:
        sock.connect((target_host, target_port))
        return sock
    except socks.ProxyConnectionError as exc:
        sock.close()
        raise ProxyServerUnreachableError(f"无法连接至代理服务器: {exc}") from exc
    except socks.SOCKS5AuthError as exc:
        sock.close()
        raise ProxyAuthError(f"代理认证失败: {exc}") from exc
    except socks.HTTPError as exc:
        sock.close()
        if "407" in str(exc):
            raise ProxyAuthError(f"代理认证失败: {exc}") from exc
        raise TargetUnreachableViaProxyError(f"通过代理连接目标主机失败: {exc}") from exc
    except socks.SOCKS5Error as exc:
        sock.close()
        raise TargetUnreachableViaProxyError(f"通过代理连接目标主机失败: {exc}") from exc
    except (socket.timeout, TimeoutError) as exc:
        sock.close()
        raise TargetUnreachableViaProxyError(f"通过代理连接目标主机超时: {exc}") from exc
    except socks.GeneralProxyError as exc:
        sock.close()
        raise TargetUnreachableViaProxyError(f"通过代理连接目标主机失败: {exc}") from exc
    except Exception as exc:
        sock.close()
        raise TargetUnreachableViaProxyError(f"通过代理连接目标主机失败: {exc}") from exc
