import socket
from unittest.mock import MagicMock, patch
import pytest
import socks

from memoria.connectors.host.proxy import (
    ProxyAuthError,
    ProxyError,
    ProxyServerUnreachableError,
    TargetUnreachableViaProxyError,
    create_proxy_socket,
    mask_proxy_url,
    merge_proxy_url,
    validate_proxy_url,
)


def test_validate_proxy_url():
    assert validate_proxy_url(None) == ""
    assert validate_proxy_url("") == ""
    assert validate_proxy_url("   ") == ""

    # SOCKS5 with explicit port
    assert validate_proxy_url("socks5://127.0.0.1:1080") == "socks5://127.0.0.1:1080"
    # SOCKS5 with default port
    assert validate_proxy_url("socks5://127.0.0.1") == "socks5://127.0.0.1:1080"
    # HTTP with explicit port
    assert validate_proxy_url("http://proxy.corp.internal:8080") == "http://proxy.corp.internal:8080"
    # HTTP with default port
    assert validate_proxy_url("http://proxy.corp.internal") == "http://proxy.corp.internal:8080"
    # SOCKS5H
    assert validate_proxy_url("socks5h://bastion.corp:1088") == "socks5h://bastion.corp:1088"
    # HTTPS
    assert validate_proxy_url("https://secure-proxy.corp:8443") == "https://secure-proxy.corp:8443"

    # With credentials
    assert (
        validate_proxy_url("socks5://user:pass@127.0.0.1:1080")
        == "socks5://user:pass@127.0.0.1:1080"
    )
    # Masked credential in URL should also pass validation
    assert (
        validate_proxy_url("socks5://user:******@127.0.0.1:1080")
        == "socks5://user:******@127.0.0.1:1080"
    )

    # Invalid schemes
    with pytest.raises(ValueError, match="Unsupported proxy scheme 'ftp'"):
        validate_proxy_url("ftp://127.0.0.1:21")

    with pytest.raises(ValueError, match="Unsupported proxy scheme 'socks4'"):
        validate_proxy_url("socks4://127.0.0.1:1080")

    # Missing hostname
    with pytest.raises(ValueError, match="Proxy URL must include a host"):
        validate_proxy_url("http://:8080")

    # Invalid port
    with pytest.raises(ValueError, match="Invalid proxy port"):
        validate_proxy_url("socks5://127.0.0.1:70000")


def test_mask_proxy_url():
    assert mask_proxy_url(None) == ""
    assert mask_proxy_url("") == ""
    assert mask_proxy_url("socks5://127.0.0.1:1080") == "socks5://127.0.0.1:1080"
    assert (
        mask_proxy_url("socks5://admin:mysecret@127.0.0.1:1080")
        == "socks5://admin:******@127.0.0.1:1080"
    )
    assert (
        mask_proxy_url("http://user:pass123@proxy.corp:8080/path?q=1")
        == "http://user:******@proxy.corp:8080/path?q=1"
    )
    # Already masked
    assert (
        mask_proxy_url("socks5://admin:******@127.0.0.1:1080")
        == "socks5://admin:******@127.0.0.1:1080"
    )


def test_merge_proxy_url():
    # If new_url is None, return old_url
    assert merge_proxy_url(None, "socks5://admin:secret@127.0.0.1:1080") == "socks5://admin:secret@127.0.0.1:1080"
    # If new_url is empty, clear it
    assert merge_proxy_url("", "socks5://admin:secret@127.0.0.1:1080") == ""
    assert merge_proxy_url("   ", "socks5://admin:secret@127.0.0.1:1080") == ""

    # Preserve password when masked
    old = "socks5://admin:my_real_secret@127.0.0.1:1080"
    masked_submission = "socks5://admin:******@127.0.0.1:1080"
    assert merge_proxy_url(masked_submission, old) == old

    # Update host/port while preserving masked password
    updated_host = "socks5://admin:******@10.0.0.2:1080"
    assert merge_proxy_url(updated_host, old) == "socks5://admin:my_real_secret@10.0.0.2:1080"

    # User changed password explicitly
    new_secret_submission = "socks5://admin:brand_new_secret@127.0.0.1:1080"
    assert merge_proxy_url(new_secret_submission, old) == new_secret_submission

    # No password in new URL
    no_pass_submission = "socks5://127.0.0.1:1080"
    assert merge_proxy_url(no_pass_submission, old) == no_pass_submission


def test_create_proxy_socket_success():
    with patch("socks.socksocket") as mock_sock_cls:
        mock_sock = MagicMock()
        mock_sock_cls.return_value = mock_sock

        sock = create_proxy_socket(
            proxy_url="socks5://admin:pass@127.0.0.1:1080",
            target_host="192.168.1.10",
            target_port=22,
            timeout=5.0,
        )

        assert sock == mock_sock
        mock_sock.settimeout.assert_called_with(5.0)
        mock_sock.set_proxy.assert_called_with(
            proxy_type=socks.PROXY_TYPE_SOCKS5,
            addr="127.0.0.1",
            port=1080,
            rdns=True,
            username="admin",
            password="pass",
        )
        mock_sock.connect.assert_called_with(("192.168.1.10", 22))


def test_create_proxy_socket_http():
    with patch("socks.socksocket") as mock_sock_cls:
        mock_sock = MagicMock()
        mock_sock_cls.return_value = mock_sock

        create_proxy_socket(
            proxy_url="http://proxy.corp:8080",
            target_host="10.0.0.5",
            target_port=22,
            timeout=3.0,
        )

        mock_sock.set_proxy.assert_called_with(
            proxy_type=socks.PROXY_TYPE_HTTP,
            addr="proxy.corp",
            port=8080,
            rdns=True,
            username=None,
            password=None,
        )


def test_create_proxy_socket_proxy_connection_error():
    with patch("socks.socksocket") as mock_sock_cls:
        mock_sock = MagicMock()
        mock_sock_cls.return_value = mock_sock
        mock_sock.connect.side_effect = socks.ProxyConnectionError("Connection refused")

        with pytest.raises(ProxyServerUnreachableError, match="无法连接至代理服务器"):
            create_proxy_socket(
                proxy_url="socks5://127.0.0.1:1080",
                target_host="192.168.1.10",
                target_port=22,
            )
        mock_sock.close.assert_called_once()


def test_create_proxy_socket_socks5_auth_error():
    with patch("socks.socksocket") as mock_sock_cls:
        mock_sock = MagicMock()
        mock_sock_cls.return_value = mock_sock
        mock_sock.connect.side_effect = socks.SOCKS5AuthError("Authentication failed")

        with pytest.raises(ProxyAuthError, match="代理认证失败"):
            create_proxy_socket(
                proxy_url="socks5://user:wrong@127.0.0.1:1080",
                target_host="192.168.1.10",
                target_port=22,
            )
        mock_sock.close.assert_called_once()


def test_create_proxy_socket_http_407_auth_error():
    with patch("socks.socksocket") as mock_sock_cls:
        mock_sock = MagicMock()
        mock_sock_cls.return_value = mock_sock
        mock_sock.connect.side_effect = socks.HTTPError("407: Proxy Authentication Required")

        with pytest.raises(ProxyAuthError, match="代理认证失败"):
            create_proxy_socket(
                proxy_url="http://user:wrong@proxy.corp:8080",
                target_host="192.168.1.10",
                target_port=22,
            )
        mock_sock.close.assert_called_once()


def test_create_proxy_socket_target_unreachable():
    with patch("socks.socksocket") as mock_sock_cls:
        mock_sock = MagicMock()
        mock_sock_cls.return_value = mock_sock
        mock_sock.connect.side_effect = socks.SOCKS5Error("0x05: Connection refused")

        with pytest.raises(TargetUnreachableViaProxyError, match="通过代理连接目标主机失败"):
            create_proxy_socket(
                proxy_url="socks5://127.0.0.1:1080",
                target_host="192.168.1.10",
                target_port=22,
            )
        mock_sock.close.assert_called_once()


def test_create_proxy_socket_missing_socks():
    with patch("memoria.connectors.host.proxy.socks", None):
        with pytest.raises(ProxyError, match="PySocks 未安装"):
            create_proxy_socket(
                proxy_url="socks5://127.0.0.1:1080",
                target_host="192.168.1.10",
                target_port=22,
            )


def test_connector_create_ssh_client_with_proxy():
    from memoria.connectors.host.connector import HostConnector
    from memoria.connectors.host.models import HostConfig

    config = HostConfig(
        id="h-proxy-1",
        name="Proxied Host",
        host="10.0.0.99",
        port=22,
        username="deploy",
        auth_type="password",
        credential="sshpassword",
        proxy_url="socks5://127.0.0.1:1080",
    )
    connector = HostConnector(config)

    mock_proxy_sock = MagicMock()
    with patch("memoria.connectors.host.proxy.create_proxy_socket", return_value=mock_proxy_sock) as mock_create_sock, \
         patch("paramiko.SSHClient") as mock_ssh_cls:
        mock_client = MagicMock()
        mock_ssh_cls.return_value = mock_client

        client = connector._create_ssh_client()
        mock_create_sock.assert_called_once_with(
            proxy_url="socks5://127.0.0.1:1080",
            target_host="10.0.0.99",
            target_port=22,
            timeout=5.0,
        )
        mock_client.connect.assert_called_once_with(
            hostname="10.0.0.99",
            port=22,
            username="deploy",
            timeout=5.0,
            sock=mock_proxy_sock,
            password="sshpassword",
        )
        assert client == mock_client


def test_connector_test_connection_diagnostics():
    from memoria.connectors.host.connector import HostConnector
    from memoria.connectors.host.models import HostConfig

    config = HostConfig(
        id="h-proxy-2",
        name="Proxied Host 2",
        host="10.0.0.99",
        port=22,
        proxy_url="socks5://127.0.0.1:1080",
    )
    connector = HostConnector(config)

    # 1. Proxy server unreachable
    with patch(
        "memoria.connectors.host.proxy.create_proxy_socket",
        side_effect=ProxyServerUnreachableError("无法连接至代理服务器: Connection refused"),
    ):
        res = connector.test_connection()
        assert res["status"] == "error"
        assert "无法连接至代理服务器" in res["message"]

    # 2. Proxy auth error
    with patch(
        "memoria.connectors.host.proxy.create_proxy_socket",
        side_effect=ProxyAuthError("代理认证失败: 407 Proxy Authentication Required"),
    ):
        res = connector.test_connection()
        assert res["status"] == "error"
        assert "代理认证失败" in res["message"]

    # 3. Target unreachable via proxy
    with patch(
        "memoria.connectors.host.proxy.create_proxy_socket",
        side_effect=TargetUnreachableViaProxyError("通过代理连接目标主机失败: 0x05 Connection refused"),
    ):
        res = connector.test_connection()
        assert res["status"] == "error"
        assert "通过代理连接目标主机失败" in res["message"]

    # 4. Proxy open probe success (no SSH credential)
    mock_sock = MagicMock()
    with patch("memoria.connectors.host.proxy.create_proxy_socket", return_value=mock_sock):
        res = connector.test_connection()
        assert res["status"] == "success"
        assert "Successfully connected" in res["message"]
        mock_sock.close.assert_called_once()

