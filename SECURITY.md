# 安全说明

gpt2codex 通过 OpenAI Secure MCP Tunnel 将一个固定的本地工作区连接到 ChatGPT。Tunnel 只建立出站连接，不在公网开放本机监听端口。ChatGPT 只读取工作区，项目修改和验证由 Codex 桌面任务完成。

## 边界

- MCP 进程启动时固定到一个工作区，远程工具不能切换目录。
- 只接受工作区内的相对路径，并通过真实路径检查阻止目录穿越和符号链接越界。
- 拒绝读取 `.env`、私钥和常见凭据目录。
- 单个文件最大 1 MiB，批量读取最多 10 个 UTF-8 文本文件。
- ChatGPT 只能调用读取工具和 `dispatch_to_codex`；不能直接写文件。
- Codex 任务只获得该工作区的写权限，网络访问关闭。
- Runtime API key 只通过环境变量传给 Tunnel，不应提交到仓库或聊天内容。

这不是完整的操作系统权限隔离：本地 Node.js 和 Codex 进程仍以当前用户身份运行，因此只应绑定可信文件夹，并在派发前检查 ChatGPT 生成的执行说明。

## 报告漏洞

请优先使用 GitHub Security Advisory 私密报告。若该入口不可用，请创建一个不包含密钥、路径或其他敏感信息的问题。
