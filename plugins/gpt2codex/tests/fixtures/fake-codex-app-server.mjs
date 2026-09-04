import readline from "node:readline";

const expectedWorkspace = process.argv[2];
const expectedPrompt = process.argv[3];
const expectedThreadId = process.argv[4] || null;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function fail(id, message) {
  send({ id, error: { code: -32602, message } });
}

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialized") return;
  if (message.method === "initialize") {
    send({ id: message.id, result: { userAgent: "fake" } });
    return;
  }
  if (message.method === "thread/start") {
    if (expectedThreadId) return fail(message.id, "expected thread/resume");
    if (message.params?.cwd !== expectedWorkspace) return fail(message.id, "wrong thread cwd");
    if (message.params?.sandbox !== "workspace-write") return fail(message.id, "wrong sandbox mode");
    send({ id: message.id, result: { thread: { id: "thread-created" } } });
    return;
  }
  if (message.method === "thread/resume") {
    if (message.params?.threadId !== expectedThreadId) return fail(message.id, "wrong resumed thread");
    send({ id: message.id, result: { thread: { id: expectedThreadId } } });
    return;
  }
  if (message.method === "turn/start") {
    if (message.params?.cwd !== expectedWorkspace) return fail(message.id, "wrong turn cwd");
    if (message.params?.input?.[0]?.text !== expectedPrompt) return fail(message.id, "wrong prompt");
    if (message.params?.sandboxPolicy?.writableRoots?.length !== 1
      || message.params.sandboxPolicy.writableRoots[0] !== expectedWorkspace) {
      return fail(message.id, "workspace is not the only writable root");
    }
    send({ id: message.id, result: { turn: { id: "turn-started", status: "inProgress" } } });
  }
});
