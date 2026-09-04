import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BindingStore,
  bindWorkspace,
  getConversationBinding,
  listDirectory,
  readFile,
  readMultipleFiles,
  sessionKeyFromMeta,
} from "../mcp/core.mjs";

const cleanupPaths = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gpt2codex-"));
  cleanupPaths.push(dir);
  return dir;
}

function write(root, relativePath, content) {
  const file = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function meta(session) {
  return { "openai/session": session };
}

test.afterEach(() => {
  for (const target of cleanupPaths.splice(0)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("sessionKeyFromMeta rejects a call without the ChatGPT conversation id", () => {
  assert.throws(() => sessionKeyFromMeta({}), /openai\/session/);
});

test("a locally fixed workspace works without private ChatGPT metadata and cannot be rebound", () => {
  const stateFile = path.join(makeTempDir(), "bindings.json");
  const workspaceA = makeTempDir();
  const workspaceB = makeTempDir();
  const store = new BindingStore(stateFile, { workspacePath: workspaceA });

  assert.deepEqual(getConversationBinding(store, {}), {
    bound: true,
    workspacePath: fs.realpathSync.native(workspaceA),
    threadId: null,
    hostId: null,
  });
  assert.throws(
    () => bindWorkspace(store, {}, workspaceB),
    /fixed local workspace/,
  );
});

test("workspace bindings persist and remain isolated per ChatGPT conversation", () => {
  const stateDir = makeTempDir();
  const workspaceA = makeTempDir();
  const workspaceB = makeTempDir();
  const stateFile = path.join(stateDir, "bindings.json");
  const firstStore = new BindingStore(stateFile);

  bindWorkspace(firstStore, meta("chat-a"), workspaceA);
  bindWorkspace(firstStore, meta("chat-b"), workspaceB);

  const reloadedStore = new BindingStore(stateFile);
  assert.equal(
    reloadedStore.get(sessionKeyFromMeta(meta("chat-a"))).workspacePath,
    fs.realpathSync.native(workspaceA),
  );
  assert.equal(
    reloadedStore.get(sessionKeyFromMeta(meta("chat-b"))).workspacePath,
    fs.realpathSync.native(workspaceB),
  );
  assert.notEqual(
    sessionKeyFromMeta(meta("chat-a")),
    sessionKeyFromMeta(meta("chat-b")),
  );
});

test("readFile rejects traversal outside the bound workspace", () => {
  const stateFile = path.join(makeTempDir(), "bindings.json");
  const workspace = makeTempDir();
  const store = new BindingStore(stateFile);
  bindWorkspace(store, meta("chat-a"), workspace);

  assert.throws(
    () => readFile(store, meta("chat-a"), "../outside.txt"),
    /outside the bound workspace/,
  );
});

test("readFile rejects sensitive files", () => {
  const stateFile = path.join(makeTempDir(), "bindings.json");
  const workspace = makeTempDir();
  write(workspace, ".env", "TOKEN=secret\n");
  const store = new BindingStore(stateFile);
  bindWorkspace(store, meta("chat-a"), workspace);

  assert.throws(
    () => readFile(store, meta("chat-a"), ".env"),
    /sensitive file/,
  );
});

test("listDirectory returns project files while omitting noisy and sensitive paths", () => {
  const stateFile = path.join(makeTempDir(), "bindings.json");
  const workspace = makeTempDir();
  write(workspace, "src/index.js", "export const answer = 42;\n");
  write(workspace, "node_modules/pkg/index.js", "hidden\n");
  write(workspace, ".env", "TOKEN=secret\n");
  const store = new BindingStore(stateFile);
  bindWorkspace(store, meta("chat-a"), workspace);

  const result = listDirectory(store, meta("chat-a"), ".", 2);
  const listedPaths = result.entries.map((entry) => entry.path);

  assert.deepEqual(listedPaths, ["src", "src/index.js"]);
});

test("readFile returns only the requested line range", () => {
  const stateFile = path.join(makeTempDir(), "bindings.json");
  const workspace = makeTempDir();
  write(workspace, "notes.txt", "one\ntwo\nthree\nfour\n");
  const store = new BindingStore(stateFile);
  bindWorkspace(store, meta("chat-a"), workspace);

  const result = readFile(store, meta("chat-a"), "notes.txt", {
    startLine: 2,
    endLine: 3,
  });

  assert.deepEqual(result, {
    path: "notes.txt",
    startLine: 2,
    endLine: 3,
    totalLines: 4,
    content: "two\nthree",
  });
});

test("readMultipleFiles reads several known files in one call", () => {
  const stateFile = path.join(makeTempDir(), "bindings.json");
  const workspace = makeTempDir();
  write(workspace, "a.txt", "alpha\n");
  write(workspace, "src/b.txt", "beta\n");
  const store = new BindingStore(stateFile);
  bindWorkspace(store, meta("chat-a"), workspace);

  const result = readMultipleFiles(store, meta("chat-a"), ["a.txt", "src/b.txt"]);

  assert.deepEqual(result, {
    files: [
      { path: "a.txt", startLine: 1, endLine: 1, totalLines: 1, content: "alpha" },
      { path: "src/b.txt", startLine: 1, endLine: 1, totalLines: 1, content: "beta" },
    ],
  });
});

test("readMultipleFiles accepts between one and ten paths", () => {
  const store = new BindingStore(path.join(makeTempDir(), "bindings.json"));

  assert.throws(() => readMultipleFiles(store, meta("chat-a"), []), /1 to 10/);
  assert.throws(
    () => readMultipleFiles(store, meta("chat-a"), Array(11).fill("a.txt")),
    /1 to 10/,
  );
});
