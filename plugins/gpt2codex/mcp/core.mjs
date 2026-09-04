import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const NOISY_DIRECTORIES = new Set([
  ".git",
  ".idea",
  ".tooling",
  ".vs",
  ".vscode",
  "Library",
  "Temp",
  "build",
  "dist",
  "node_modules",
]);

function defaultBindingFile() {
  const base = process.env.GPT2CODEX_STATE_DIR
    ?? (process.platform === "win32"
      ? process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local")
      : process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"));
  return path.join(base, "gpt2codex", "bindings.json");
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
}

export function sessionKeyFromMeta(meta) {
  const session = meta?.["openai/session"];
  if (typeof session !== "string" || session.trim() === "") {
    throw new Error("openai/session metadata is required for ChatGPT conversation binding.");
  }
  return createHash("sha256").update(session).digest("hex");
}

export class BindingStore {
  constructor(file = defaultBindingFile(), options = {}) {
    this.file = file;
    this.fixedWorkspacePath = options.workspacePath
      ? canonicalWorkspace(options.workspacePath)
      : null;
  }

  get(sessionKey) {
    return readJson(this.file)[sessionKey] ?? null;
  }

  set(sessionKey, binding) {
    const bindings = readJson(this.file);
    bindings[sessionKey] = binding;
    writeJson(this.file, bindings);
    return binding;
  }

  key(meta) {
    if (this.fixedWorkspacePath) {
      return createHash("sha256").update(`workspace:${this.fixedWorkspacePath}`).digest("hex");
    }
    return sessionKeyFromMeta(meta);
  }

  getBinding(meta) {
    const binding = this.get(this.key(meta));
    if (!this.fixedWorkspacePath) return binding;
    return {
      workspacePath: this.fixedWorkspacePath,
      ...(binding?.threadId ? { threadId: binding.threadId } : {}),
      ...(binding?.hostId ? { hostId: binding.hostId } : {}),
    };
  }

  setBinding(meta, binding) {
    if (this.fixedWorkspacePath && binding.workspacePath !== this.fixedWorkspacePath) {
      throw new Error("The server is pinned to a different fixed local workspace.");
    }
    return this.set(this.key(meta), binding);
  }
}

function canonicalWorkspace(workspacePath) {
  if (typeof workspacePath !== "string" || !path.isAbsolute(workspacePath)) {
    throw new Error("workspacePath must be an absolute path.");
  }
  const resolved = fs.realpathSync.native(workspacePath);
  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error("workspacePath must point to a directory.");
  }
  return resolved;
}

export function bindWorkspace(store, meta, workspacePath) {
  const resolved = canonicalWorkspace(workspacePath);

  if (store.fixedWorkspacePath && store.fixedWorkspacePath !== resolved) {
    throw new Error("The server is pinned to another fixed local workspace.");
  }

  const previous = store.getBinding(meta);
  if (previous && previous.workspacePath !== resolved) {
    throw new Error("This ChatGPT conversation is already bound to another workspace. Start a new ChatGPT conversation to use a different workspace.");
  }
  const binding = { workspacePath: resolved };
  if (previous?.workspacePath === resolved && previous.threadId) {
    binding.threadId = previous.threadId;
    if (previous.hostId) binding.hostId = previous.hostId;
  }
  store.setBinding(meta, binding);
  return { workspacePath: resolved, reusedThread: Boolean(binding.threadId) };
}

export function getConversationBinding(store, meta) {
  const binding = store.getBinding(meta);
  return {
    bound: Boolean(binding),
    workspacePath: binding?.workspacePath ?? null,
    threadId: binding?.threadId ?? null,
    hostId: binding?.hostId ?? null,
  };
}

export function bindCodexTask(store, meta, threadId, hostId = null) {
  if (typeof threadId !== "string" || threadId.trim() === "") {
    throw new Error("threadId must be a non-empty string.");
  }
  if (hostId !== null && (typeof hostId !== "string" || hostId.trim() === "")) {
    throw new Error("hostId must be a non-empty string when provided.");
  }

  const binding = store.getBinding(meta);
  if (!binding) throw new Error("No workspace is bound to this ChatGPT conversation.");
  store.setBinding(meta, {
    workspacePath: binding.workspacePath,
    threadId,
    ...(hostId ? { hostId } : {}),
  });
  return getConversationBinding(store, meta);
}

function isSensitive(relativePath) {
  return relativePath.split(/[\\/]+/).some((part) => {
    const name = part.toLowerCase();
    if (name === ".env" || (name.startsWith(".env.") && name !== ".env.example")) return true;
    if ([".aws", ".gnupg", ".ssh", "credentials"].includes(name)) return true;
    if (/^(id_rsa|id_ed25519)(\.pub)?$/.test(name)) return true;
    if (/\.(key|p12|pem|pfx)$/.test(name)) return true;
    return /^service-account.*\.json$/.test(name);
  });
}

function requireBinding(store, meta) {
  const binding = store.getBinding(meta);
  if (!binding) {
    throw new Error("No workspace is bound to this ChatGPT conversation.");
  }
  return binding;
}

function resolveInsideWorkspace(workspacePath, relativePath) {
  const requested = relativePath || ".";
  if (path.isAbsolute(requested)) {
    throw new Error("File paths must be relative to the bound workspace.");
  }
  if (isSensitive(requested)) {
    throw new Error("Access to this sensitive file is denied.");
  }

  const candidate = path.resolve(workspacePath, requested);
  const relative = path.relative(workspacePath, candidate);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Requested path is outside the bound workspace.");
  }

  const resolved = fs.realpathSync.native(candidate);
  const realRelative = path.relative(workspacePath, resolved);
  if (realRelative === ".." || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
    throw new Error("Requested path is outside the bound workspace.");
  }
  return resolved;
}

function portableRelative(root, target) {
  return path.relative(root, target).split(path.sep).join("/");
}

export function listDirectory(store, meta, relativePath = ".", depth = 1) {
  if (!Number.isInteger(depth) || depth < 1 || depth > 4) {
    throw new Error("depth must be an integer from 1 to 4.");
  }
  const { workspacePath } = requireBinding(store, meta);
  const start = resolveInsideWorkspace(workspacePath, relativePath);
  if (!fs.statSync(start).isDirectory()) {
    throw new Error("Requested path is not a directory.");
  }

  const entries = [];
  const walk = (directory, level) => {
    const children = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const relative = portableRelative(workspacePath, path.join(directory, child.name));
      if (isSensitive(relative)) continue;
      if (child.isDirectory() && NOISY_DIRECTORIES.has(child.name)) continue;
      if (!child.isDirectory() && !child.isFile()) continue;
      entries.push({ path: relative, type: child.isDirectory() ? "directory" : "file" });
      if (child.isDirectory() && level < depth) {
        walk(path.join(directory, child.name), level + 1);
      }
    }
  };
  walk(start, 1);
  return { path: relativePath, entries };
}

export function readFile(store, meta, relativePath, options = {}) {
  const { workspacePath } = requireBinding(store, meta);
  const file = resolveInsideWorkspace(workspacePath, relativePath);
  const stats = fs.statSync(file);
  if (!stats.isFile()) throw new Error("Requested path is not a file.");
  if (stats.size > 1024 * 1024) throw new Error("File is larger than 1 MiB.");

  const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  if (text.includes("\0")) throw new Error("Binary files are not supported.");
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();

  const startLine = options.startLine ?? 1;
  const endLine = options.endLine ?? Math.min(lines.length, startLine + 399);
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
    throw new Error("Invalid line range.");
  }
  return {
    path: portableRelative(workspacePath, file),
    startLine,
    endLine: Math.min(endLine, lines.length),
    totalLines: lines.length,
    content: lines.slice(startLine - 1, endLine).join("\n"),
  };
}

export function readMultipleFiles(store, meta, relativePaths) {
  if (
    !Array.isArray(relativePaths)
    || relativePaths.length < 1
    || relativePaths.length > 10
    || relativePaths.some((item) => typeof item !== "string" || item.trim() === "")
  ) {
    throw new Error("paths must contain 1 to 10 file paths.");
  }
  return { files: relativePaths.map((file) => readFile(store, meta, file)) };
}
