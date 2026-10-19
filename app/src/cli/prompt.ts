import { createInterface } from "node:readline/promises";

/** Reads a line; with `hidden`, nothing is echoed. Falls back to plain reads when stdin isn't a TTY. */
export async function ask(question: string, opts: { hidden?: boolean } = {}): Promise<string> {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) return readPipedLine();
  if (!opts.hidden) {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      return (await rl.question(question)).trim();
    } finally {
      rl.close();
    }
  }

  stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let value = "";
    const done = (fn: () => void) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      stdout.write("\n");
      fn();
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") return done(() => resolve(value));
        if (ch === "\u0003") return done(() => reject(new Error("cancelled")));
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

// Piped input (e.g. `printf '%s\n' "$PW" "$PW" | scrappy user add ...`): one reader for all questions.
let piped: AsyncIterator<string> | undefined;

async function readPipedLine(): Promise<string> {
  piped ??= createInterface({ input: process.stdin, terminal: false })[Symbol.asyncIterator]();
  const next = await piped.next();
  if (next.done) throw new Error("unexpected end of input");
  return next.value.replace(/\r$/, "");
}
