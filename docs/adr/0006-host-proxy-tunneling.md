# ADR 0006: 主机连接可选代理隧道支持 (HTTP CONNECT & SOCKS5)

## Status

Accepted

## Context

在 Memoria 现有的基础设施连接器架构中，受管主机（`Host`）均通过本地直接建立 TCP 连接并进行 SSH 握手（`HostConnector` 与 `SSHConnectionPool`）。
然而在混合云、跨 VPC 及网络隔离等常见企业与个人部署场景中，许多服务器节点位于内网或受限网络，Memoria 宿主机无法直连其 SSH 端口（22）。需要支持为主机节点按需配置出口代理，通过已有的 HTTP 代理或 SOCKS5 代理打通隧道。

在设计方案时面临以下权衡：
1. **配置形态**：细分多字段（`proxy_type`, `proxy_host`, `proxy_port` 等）还是统一的 URL 字符串？
2. **敏感信息安全**：代理中包含的用户名和密码凭证如何持久化和回显？
3. **隧道实现依赖**：是自研 socket 握手协议、调用系统 CLI 命令（`ProxyCommand`），还是引入专职轻量库？
4. **域名解析（DNS）**：内网域名在本地无法解析时如何避免解析失败？
5. **探活与排障**：连通性测试（`test_connection`）如何区分代理服务器故障与目标主机故障？

## Decision

1. **统一 URI 建模与 Scheme 校验**：
   - 使用统一的 `proxy_url` 字段（例如 `socks5://127.0.0.1:1080` 或 `http://user:pass@127.0.0.1:7890`）。
   - 严格支持 `http://`、`https://`、`socks5://` 及 `socks5h://` 四种 URI Scheme；留空或为 None 时表示直接连接。
   - 对 SOCKS5 代理强制采用远程 DNS 解析（Remote DNS，即 `rdns=True`），彻底避免部署宿主机对内网主机名本地 DNS 解析失败或污染。

2. **凭据安全加密与智能脱敏回显**：
   - 数据库存储层（SQLite / PostgreSQL `hosts` 表）中，非空 `proxy_url` 统一经 `encrypt_secret` 对称加密存储，解密仅发生在连接器建立隧道与测试时。
   - 对外接口（`HostOut`）对带认证密码的 URL 进行脱敏回显（如 `socks5://user:******@host:port`）。
   - 编辑更新（`HostUpdate`）若回传包含掩码 `******` 的代理串，后端自动识别并复用已有的加密凭据，防止基础信息修改时意外覆盖或清空密码。

3. **依赖选型与套接字工厂**：
   - 引入零 C 依赖的纯 Python 标准轻量库 `PySocks`。
   - 在 `memoria/connectors/host/proxy.py` 实现统一的代理套接字创建器（`create_proxy_socket`），通过 `socks.socksocket` 完成前置 HTTP CONNECT / SOCKS5 协商，并将生成的打通套接字作为 `sock` 参数传入 Paramiko `SSHClient.connect(sock=...)`。
   - 严格将代理逻辑收敛于主机连接器模块，不影响 LLM Caller、WebDAV 等其他网络组件。

4. **分层排障与连通性诊断**：
   - 改造 `test_connection()`：若配置了代理，优先测试与代理服务器的握手与隧道穿透，若失败明确区分输出“代理连接失败: 无法连接至代理服务器”与“通过代理连接目标主机失败: 目标端口不可达/超时”，提供精准运维排障反馈。

## Consequences

- **优点**:
  - 极大拓展了受控主机的接入场景，支持纳管堡垒机后方、内网网段及外网跨界服务器。
  - 标准 URL 模型与现有主机凭证加密策略完全对齐，安全性与用户体验一致。
  - 代理逻辑全内聚在 `memoria/connectors/host`，上层 Multi-Agent 编排与工具调用无需任何感知与改造。
- **成本与权衡**:
  - 新增 `PySocks` 运行时依赖（约 16 KB）。
  - 数据库 `hosts` 表新增 `proxy_url` 字段，需进行 Schema 迁移。
