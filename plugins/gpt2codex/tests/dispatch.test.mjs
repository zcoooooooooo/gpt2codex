import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { BindingStore, bindCodexTask, getConversationBinding } from "../mcp/core.mjs";
import { CodexAppServerClient, dispatchToCodex } from "../mcp/codex.mjs";

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-codex-app-server.mjs");
const cleanupPaths = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gpt2codex-dispatch-"));
  cleanupPaths.push(dir);
  return dir;
}

test.afterEach(() => {
  for (const target of cleanupPaths.splice(0)) fs.rmSync(target, { recursive: true, force: true });
});

test("dispatchToCodex creates a task, starts its turn, and persists the task id", async () => {
  const workspace = makeTempDir();
  const store = new BindingStore(path.join(makeTempDir(), "bindings.json"), { workspacePath: workspace });
  const prompt = "Implement the approved plan and run tests.";
  const client = new CodexAppServerClient({ command: process.execPath, args: [fixture, workspace, prompt] });

  try {
    const result = await dispatchToCodex(store, {}, prompt, client);
    assert.deepEqual(result, {
      threadId: "thread-created",
      turnId: "turn-started",
      status: "inProgress",
      created: true,
    });
    assert.equal(getConversationBinding(store, {}).threadId, "thread-created");
  } finally {
    client.close();
  }
});

test("dispatchToCodex resumes the task already bound to the fixed workspace", async () => {
  const workspace = makeTempDir();
  const store = new BindingStore(path.join(makeTempDir(), "bindings.json"), { workspacePath: workspace });
  const prompt = "Continue with the revised plan.";
  bindCodexTask(store, {}, "thread-existing", "local");
  const client = new CodexAppServerClient({
    command: process.execPath,
    args: [fixture, workspace, prompt, "thread-existing"],
  });

  try {
    const result = await dispatchToCodex(store, {}, prompt, client);
    assert.equal(result.threadId, "thread-existing");
    assert.equal(result.created, false);
  } finally {
    client.close();
  }
});
