import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BindingStore,
  bindCodexTask,
  bindWorkspace,
  getConversationBinding,
} from "../mcp/core.mjs";

const cleanupPaths = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gpt2codex-binding-"));
  cleanupPaths.push(dir);
  return dir;
}

function meta(session) {
  return { "openai/session": session };
}

test.afterEach(() => {
  for (const target of cleanupPaths.splice(0)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("Codex desktop task binding persists with the conversation workspace", () => {
  const stateFile = path.join(makeTempDir(), "bindings.json");
  const workspace = makeTempDir();
  const store = new BindingStore(stateFile);
  bindWorkspace(store, meta("chat-a"), workspace);

  const result = bindCodexTask(store, meta("chat-a"), "thread-a", "local");

  assert.deepEqual(result, {
    bound: true,
    workspacePath: fs.realpathSync.native(workspace),
    threadId: "thread-a",
    hostId: "local",
  });
  assert.deepEqual(
    getConversationBinding(new BindingStore(stateFile), meta("chat-a")),
    result,
  );
});

test("rebinding the same workspace keeps its Codex task", () => {
  const store = new BindingStore(path.join(makeTempDir(), "bindings.json"));
  const workspaceA = makeTempDir();
  const metadata = meta("chat-a");

  bindWorkspace(store, metadata, workspaceA);
  bindCodexTask(store, metadata, "thread-a", "local");
  bindWorkspace(store, metadata, workspaceA);
  assert.equal(getConversationBinding(store, metadata).threadId, "thread-a");
});

test("a ChatGPT conversation cannot be rebound to a different workspace", () => {
  const store = new BindingStore(path.join(makeTempDir(), "bindings.json"));
  const workspaceA = makeTempDir();
  const workspaceB = makeTempDir();
  const metadata = meta("chat-a");

  bindWorkspace(store, metadata, workspaceA);
  assert.throws(
    () => bindWorkspace(store, metadata, workspaceB),
    /already bound.*new ChatGPT conversation/i,
  );
  assert.deepEqual(getConversationBinding(store, metadata), {
    bound: true,
    workspacePath: fs.realpathSync.native(workspaceA),
    threadId: null,
    hostId: null,
  });
});

test("different ChatGPT conversations cannot see each other's Codex task binding", () => {
  const store = new BindingStore(path.join(makeTempDir(), "bindings.json"));
  const workspace = makeTempDir();
  bindWorkspace(store, meta("chat-a"), workspace);
  bindWorkspace(store, meta("chat-b"), workspace);
  bindCodexTask(store, meta("chat-a"), "thread-a", "local");

  assert.equal(getConversationBinding(store, meta("chat-a")).threadId, "thread-a");
  assert.equal(getConversationBinding(store, meta("chat-b")).threadId, null);
});

test("a Codex task cannot be bound before its conversation has a workspace", () => {
  const store = new BindingStore(path.join(makeTempDir(), "bindings.json"));

  assert.throws(
    () => bindCodexTask(store, meta("chat-a"), "thread-a", "local"),
    /No workspace is bound/,
  );
});
