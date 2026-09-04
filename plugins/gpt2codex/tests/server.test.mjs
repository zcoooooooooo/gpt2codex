import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import test from "node:test";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cleanupPaths = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gpt2codex-server-"));
  cleanupPaths.push(dir);
  return dir;
}

function startServer(stateDir, args = []) {
  const child = spawn(process.execPath, ["mcp/server.mjs", ...args], {
    cwd: pluginRoot,
    env: { ...process.env, GPT2CODEX_STATE_DIR: stateDir },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const lines = readline.createInterface({ input: child.stdout });
  const pending = new Map();
  let nextId = 1;
  let stderr = "";

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    waiter.resolve(message);
  });
  child.on("exit", (code) => {
    for (const waiter of pending.values()) {
      waiter.reject(new Error(`MCP server exited with code ${code}: ${stderr}`));
    }
    pending.clear();
  });

  return {
    request(method, params = {}) {
      const id = nextId++;
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    notify(method, params = {}) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    },
    close() {
      child.kill();
    },
  };
}

function resultJson(message) {
  const text = message.result.content[0].text;
  return JSON.parse(text);
}

test.afterEach(() => {
  for (const target of cleanupPaths.splice(0)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("stdio MCP server exposes workspace reads and conversation binding", { timeout: 5000 }, async () => {
  const stateDir = makeTempDir();
  const workspace = makeTempDir();
  fs.writeFileSync(path.join(workspace, "brief.txt"), "line one\nline two\n");
  fs.writeFileSync(path.join(workspace, "notes.txt"), "note\n");
  const server = startServer(stateDir);
  const metadata = { "openai/session": "chat-test" };

  try {
    const initialized = await server.request("initialize", {
      protocolVersion: "2025-11-25",
      clientInfo: { name: "test", version: "1.0.0" },
      capabilities: {},
    });
    assert.equal(initialized.result.serverInfo.name, "gpt2codex");
    server.notify("notifications/initialized");

    const listed = await server.request("tools/list");
    assert.deepEqual(
      listed.result.tools.map((tool) => tool.name),
      [
        "bind_workspace",
        "get_binding",
        "bind_codex_task",
        "dispatch_to_codex",
        "list_directory",
        "read_file",
        "read_multiple_files",
      ],
    );

    const bound = await server.request("tools/call", {
      name: "bind_workspace",
      arguments: { workspace_path: workspace },
      _meta: metadata,
    });
    assert.equal(resultJson(bound).workspacePath, fs.realpathSync.native(workspace));

    const taskBound = await server.request("tools/call", {
      name: "bind_codex_task",
      arguments: { thread_id: "thread-test", host_id: "local" },
      _meta: metadata,
    });
    assert.equal(resultJson(taskBound).threadId, "thread-test");

    const binding = await server.request("tools/call", {
      name: "get_binding",
      arguments: {},
      _meta: metadata,
    });
    assert.deepEqual(resultJson(binding), {
      bound: true,
      workspacePath: fs.realpathSync.native(workspace),
      threadId: "thread-test",
      hostId: "local",
    });

    const directory = await server.request("tools/call", {
      name: "list_directory",
      arguments: { path: ".", depth: 1 },
      _meta: metadata,
    });
    assert.deepEqual(resultJson(directory).entries, [
      { path: "brief.txt", type: "file" },
      { path: "notes.txt", type: "file" },
    ]);

    const file = await server.request("tools/call", {
      name: "read_file",
      arguments: { path: "brief.txt", start_line: 2, end_line: 2 },
      _meta: metadata,
    });
    assert.equal(resultJson(file).content, "line two");

    const files = await server.request("tools/call", {
      name: "read_multiple_files",
      arguments: { paths: ["brief.txt", "notes.txt"] },
      _meta: metadata,
    });
    assert.deepEqual(
      resultJson(files).files.map((entry) => entry.content),
      ["line one\nline two", "note"],
    );
  } finally {
    server.close();
  }
});

test("stdio MCP server refuses calls that lack ChatGPT session metadata", { timeout: 5000 }, async () => {
  const server = startServer(makeTempDir());
  try {
    await server.request("initialize", {
      protocolVersion: "2025-11-25",
      clientInfo: { name: "test", version: "1.0.0" },
      capabilities: {},
    });
    const response = await server.request("tools/call", {
      name: "list_directory",
      arguments: {},
    });
    assert.equal(response.result.isError, true);
    assert.match(response.result.content[0].text, /openai\/session/);
  } finally {
    server.close();
  }
});

test("stdio MCP server can be pinned locally to one workspace for tunnel use", { timeout: 5000 }, async () => {
  const workspace = makeTempDir();
  const server = startServer(makeTempDir(), ["--workspace", workspace]);
  try {
    await server.request("initialize", {
      protocolVersion: "2025-11-25",
      clientInfo: { name: "test", version: "1.0.0" },
      capabilities: {},
    });
    const listed = await server.request("tools/list");
    assert.deepEqual(
      listed.result.tools.map((tool) => tool.name),
      ["get_binding", "dispatch_to_codex", "list_directory", "read_file", "read_multiple_files"],
    );
    const response = await server.request("tools/call", {
      name: "get_binding",
      arguments: {},
    });
    assert.equal(resultJson(response).workspacePath, fs.realpathSync.native(workspace));
  } finally {
    server.close();
  }
});
