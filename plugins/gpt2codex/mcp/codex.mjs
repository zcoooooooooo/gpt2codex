import { spawn } from "node:child_process";
import readline from "node:readline";

import { bindCodexTask, getConversationBinding } from "./core.mjs";

export class CodexAppServerClient {
  constructor(options = {}) {
    this.command = options.command ?? "codex";
    this.args = options.args ?? ["app-server"];
    this.child = null;
    this.pending = new Map();
    this.nextId = 1;
  }

  start() {
    if (this.child) return;
    this.child = spawn(this.command, this.args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    readline.createInterface({ input: this.child.stdout }).on("line", (line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.id !== undefined && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      }
      if (message.method === "turn/completed" && this.pending.size === 0) this.close();
    });
    this.child.on("error", (error) => this.rejectAll(error));
    this.child.on("exit", (code) => {
      if (this.pending.size) this.rejectAll(new Error(`Codex app-server exited with code ${code}.`));
      this.child = null;
    });
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  request(method, params) {
    this.start();
    const id = this.nextId++;
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server timed out during ${method}.`));
      }, 15000);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.child.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
    return response;
  }

  notify(method, params = {}) {
    this.child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  async dispatch({ workspacePath, threadId, prompt }) {
    await this.request("initialize", {
      clientInfo: { name: "gpt2codex", title: "gpt2codex", version: "0.2.0" },
    });
    this.notify("initialized");

    const created = !threadId;
    const threadResult = await this.request(created ? "thread/start" : "thread/resume", created
      ? {
          cwd: workspacePath,
          approvalPolicy: "never",
          sandbox: "workspace-write",
          serviceName: "gpt2codex",
        }
      : { threadId });
    const activeThreadId = threadResult.thread.id;
    const turnResult = await this.request("turn/start", {
      threadId: activeThreadId,
      input: [{ type: "text", text: prompt }],
      cwd: workspacePath,
      approvalPolicy: "never",
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: [workspacePath],
        networkAccess: false,
      },
    });

    return {
      threadId: activeThreadId,
      turnId: turnResult.turn.id,
      status: turnResult.turn.status,
      created,
    };
  }

  close() {
    if (this.child && !this.child.killed) this.child.kill();
  }
}

export async function dispatchToCodex(store, meta, prompt, client = new CodexAppServerClient()) {
  if (typeof prompt !== "string" || prompt.trim() === "") {
    throw new Error("prompt must be a non-empty string.");
  }
  const binding = getConversationBinding(store, meta);
  if (!binding.bound) throw new Error("No workspace is bound to this ChatGPT conversation.");

  const result = await client.dispatch({
    workspacePath: binding.workspacePath,
    threadId: binding.threadId,
    prompt,
  });
  bindCodexTask(store, meta, result.threadId, "local");
  return result;
}
