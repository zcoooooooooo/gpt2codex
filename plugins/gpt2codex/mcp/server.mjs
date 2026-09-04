import readline from "node:readline";

import {
  BindingStore,
  bindCodexTask,
  bindWorkspace,
  getConversationBinding,
  listDirectory,
  readFile,
  readMultipleFiles,
} from "./core.mjs";
import { dispatchToCodex } from "./codex.mjs";

function workspaceArgument() {
  const index = process.argv.indexOf("--workspace");
  if (index < 0) return null;
  if (!process.argv[index + 1]) throw new Error("--workspace requires an absolute folder path.");
  return process.argv[index + 1];
}

const store = new BindingStore(undefined, { workspacePath: workspaceArgument() });

const tools = [
  {
    name: "bind_workspace",
    title: "Bind local workspace",
    description: "Bind an absolute local folder to the current ChatGPT conversation.",
    inputSchema: {
      type: "object",
      properties: { workspace_path: { type: "string" } },
      required: ["workspace_path"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "get_binding",
    title: "Get conversation binding",
    description: "Get the workspace and Codex task bound to the current ChatGPT conversation.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "bind_codex_task",
    title: "Bind Codex desktop task",
    description: "Save a Codex desktop task id for the current ChatGPT conversation.",
    inputSchema: {
      type: "object",
      properties: {
        thread_id: { type: "string" },
        host_id: { type: "string" },
      },
      required: ["thread_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "dispatch_to_codex",
    title: "Start Codex desktop work",
    description: "Use this when the user asks to implement an approved plan in the locally fixed workspace. Creates or continues a Codex task and starts execution.",
    inputSchema: {
      type: "object",
      properties: { prompt: { type: "string", minLength: 1 } },
      required: ["prompt"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "list_directory",
    title: "List workspace directory",
    description: "List files and folders inside the bound workspace.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        depth: { type: "integer", minimum: 1, maximum: 4 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "read_file",
    title: "Read workspace file",
    description: "Read a UTF-8 text file inside the bound workspace, optionally by line range.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        start_line: { type: "integer", minimum: 1 },
        end_line: { type: "integer", minimum: 1 },
      },
      required: ["path"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "read_multiple_files",
    title: "Read multiple workspace files",
    description: "Read up to ten UTF-8 text files inside the bound workspace.",
    inputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 10,
        },
      },
      required: ["paths"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
];

const advertisedTools = store.fixedWorkspacePath
  ? tools.filter((tool) => !["bind_workspace", "bind_codex_task"].includes(tool.name))
  : tools;

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

function textResult(value, isError = false) {
  return {
    content: [{ type: "text", text: isError ? String(value) : JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

async function callTool(name, args, meta) {
  switch (name) {
    case "bind_workspace":
      return bindWorkspace(store, meta, args.workspace_path);
    case "get_binding":
      return getConversationBinding(store, meta);
    case "bind_codex_task":
      return bindCodexTask(store, meta, args.thread_id, args.host_id ?? null);
    case "dispatch_to_codex":
      return dispatchToCodex(store, meta, args.prompt);
    case "list_directory":
      return listDirectory(store, meta, args.path ?? ".", args.depth ?? 1);
    case "read_file":
      return readFile(store, meta, args.path, {
        startLine: args.start_line,
        endLine: args.end_line,
      });
    case "read_multiple_files":
      return readMultipleFiles(store, meta, args.paths);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handle(message) {
  if (message.id === undefined) return;
  if (message.method === "initialize") {
    send({
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "gpt2codex", version: "0.1.0" },
        instructions: store.fixedWorkspacePath
          ? "Inspect the fixed local workspace with read tools. When the user asks to implement or modify it, send a self-contained plan to dispatch_to_codex."
          : "Bind one local workspace before reading it or dispatching work to Codex.",
      },
    });
    return;
  }
  if (message.method === "tools/list") {
    send({ id: message.id, result: { tools: advertisedTools } });
    return;
  }
  if (message.method === "tools/call") {
    try {
      const result = await callTool(
        message.params?.name,
        message.params?.arguments ?? {},
        message.params?._meta,
      );
      send({ id: message.id, result: textResult(result) });
    } catch (error) {
      send({ id: message.id, result: textResult(error.message, true) });
    }
    return;
  }
  send({ id: message.id, error: { code: -32601, message: "Method not found" } });
}

const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  handle(JSON.parse(line)).catch((error) => {
    send({ id: null, error: { code: -32700, message: error.message } });
  });
});
