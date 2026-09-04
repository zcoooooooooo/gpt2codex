# gpt2codex

一个面向 Codex 桌面端的本地桥接插件：ChatGPT 通过 OpenAI Secure MCP Tunnel 读取指定项目、整理执行说明，再把工作直接交给本机 Codex 桌面任务。

## 安装

```powershell
git clone https://github.com/zcoooooooooo/gpt2codex.git D:\gpt2codex
codex plugin marketplace add D:\gpt2codex
codex plugin add gpt2codex@personal
```

安装或更新后，请新建一个 Codex 对话再使用插件。

## 连接 ChatGPT

1. 在 [OpenAI Tunnels](https://platform.openai.com/settings/organization/tunnels) 创建 Tunnel。
2. 在 [Runtime API keys](https://platform.openai.com/settings/organization/api-keys) 创建运行时密钥。
3. 从 [OpenAI tunnel-client](https://github.com/openai/tunnel-client/releases/latest) 下载 Windows x64 版并解压到 `D:\gpt2codex\.local\tunnel-client`。
4. 在 PowerShell 中运行：

```powershell
D:\gpt2codex\scripts\start-tunnel.ps1 -Workspace D:\path\to\your-project -TunnelId tunnel_xxx
```

脚本只在当前进程没有 `CONTROL_PLANE_API_KEY` 时安全提示输入密钥，不会把密钥写进仓库。Tunnel 启动后，在 ChatGPT 的“设置 → 连接器”中创建开发者模式应用，传输方式选择 **Tunnel**，再选择刚创建的 Tunnel。

## 使用

1. 启动 Tunnel 时用 `-Workspace` 指定唯一允许访问的文件夹。
2. 在 ChatGPT 新对话中 `@gpt2codex` 并说明需求。
3. ChatGPT 读取项目并整理说明；当你要求实现、修改或“干活”时，插件会创建或继续该工作区对应的 Codex 桌面任务。
4. 要切换工作区，先运行 `tunnel-client runtimes stop gpt2codex`，再用新的 `-Workspace` 重新运行启动脚本。

示例：

```text
@gpt2codex 读取当前项目，分析这个报错并交给 Codex 修复和验证。
```

## 边界

- 只能读取已绑定文件夹内部的 UTF-8 文本文件。
- 已知文件可一次批量读取 1 到 10 个。
- 拒绝 `.env`、私钥、凭据目录等常见敏感文件。
- ChatGPT 不直接写项目；修改和验证由 Codex 桌面任务完成。
- Tunnel 进程固定到启动时指定的一个工作区，ChatGPT 不能远程切换到其他文件夹。
- 同一工作区会继续使用已绑定的 Codex 任务；切换工作区需重启 Tunnel。
- Tunnel 只建立出站连接，不在公网暴露本机监听端口；运行期间需要保持后台进程在线。

更完整的安全边界见 [SECURITY.md](SECURITY.md)。

## 验证

在 `D:\gpt2codex\plugins\gpt2codex` 中运行：

```powershell
npm test
```

GitHub Actions 会在 Windows 和 Linux 的 Node.js 20 上执行同一组测试。

## 参考

- [官方 Filesystem MCP Server](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem)：工作区边界、真实路径检查和批量读取思路。
- [Local Codex Bridge](https://github.com/zoeynine/Local-Codex-Bridge)：以原生 Codex 任务作为执行记录的思路。

## 许可证

[MIT](LICENSE)
