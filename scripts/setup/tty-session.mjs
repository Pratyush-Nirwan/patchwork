import { PassThrough } from "stream";

if (!process.env.TERM) {
  process.env.TERM = "xterm-256color";
}

const clackPromise = import("@clack/prompts");
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";

export function applyAnsiToScreenLines(rawChunks) {
  const full = Array.isArray(rawChunks)
    ? rawChunks.join("")
    : String(rawChunks);
  const lines = [""];
  let row = 0;
  let colAtStart = false;

  let i = 0;
  while (i < full.length) {
    if (full[i] === "\x1b" && full[i + 1] === "[") {
      const privMatch = full.slice(i).match(/^\x1b\[\?[0-9;]*[A-Za-z]/);
      if (privMatch) {
        i += privMatch[0].length;
        continue;
      }
      const sgrMatch = full.slice(i).match(/^\x1b\[[0-9;]*m/);
      if (sgrMatch) {
        i += sgrMatch[0].length;
        continue;
      }
      const match = full.slice(i).match(/^\x1b\[(\d*)([A-Za-z])/);
      if (match) {
        const hasNum = match[1].length > 0;
        const count = hasNum ? Number(match[1]) : 1;
        const code = match[2];
        if (code === "A") {
          row = Math.max(0, row - count);
        } else if (code === "B") {
          row += count;
          while (lines.length <= row) {
            lines.push("");
          }
        } else if (code === "D") {
          if (count >= 50) {
            colAtStart = true;
          }
        } else if (code === "G") {
          if (!hasNum || count <= 1) {
            colAtStart = true;
          }
        } else if (code === "K") {
          lines[row] = "";
          colAtStart = false;
        } else if (code === "J") {
          const jMode = hasNum ? Number(match[1]) : 0;
          if (jMode === 0) {
            lines[row] = "";
            lines.splice(row + 1);
            colAtStart = false;
          } else if (jMode === 2) {
            lines.splice(0, lines.length, "");
            row = 0;
            colAtStart = false;
          }
        }
        i += match[0].length;
        continue;
      }
    }
    const ch = full[i];
    if (ch === "\n") {
      colAtStart = false;
      row += 1;
      if (row >= lines.length) {
        lines.push("");
      }
    } else if (ch === "\r") {
      colAtStart = true;
    } else {
      if (colAtStart) {
        lines[row] = "";
        colAtStart = false;
      }
      lines[row] = (lines[row] || "") + ch;
    }
    i++;
  }

  return lines.join("\n");
}

export function tokenizeInputChunk(str) {
  const tokens = [];
  let i = 0;
  while (i < str.length) {
    if (str[i] === "\r" && str[i + 1] === "\n") {
      tokens.push("\r");
      i += 2;
      continue;
    }
    if (str[i] === "\n" || str[i] === "\r") {
      tokens.push("\r");
      i += 1;
      continue;
    }
    if (str[i] === "\x03") {
      tokens.push("\x03");
      i += 1;
      continue;
    }
    if (str[i] === "\x1b") {
      const csi = str.slice(i).match(/^\x1b\[[0-9;]*[A-Za-z~]/);
      if (csi) {
        tokens.push(csi[0]);
        i += csi[0].length;
        continue;
      }
      const ss3 = str.slice(i).match(/^\x1bO[A-Za-z]/);
      if (ss3) {
        tokens.push(ss3[0]);
        i += ss3[0].length;
        continue;
      }
      tokens.push("\x1b");
      i += 1;
      continue;
    }
    tokens.push(str[i]);
    i += 1;
  }
  return tokens;
}

export function drainRawStreamBeforeSession(inputStream) {
  if (!inputStream) return [];
  const preEnded =
    Boolean(inputStream.readableEnded) || Boolean(inputStream.writableEnded);
  if (typeof inputStream.pause === "function") {
    inputStream.pause();
  }
  const chunks = [];
  if (typeof inputStream.read === "function") {
    let chunk;
    while ((chunk = inputStream.read()) !== null) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
  }
  if (typeof inputStream.resume === "function") {
    inputStream.resume();
  }
  if (!preEnded || chunks.length === 0) {
    return [];
  }
  const text = Buffer.concat(chunks).toString("utf8");
  const tokens = tokenizeInputChunk(text);
  while (tokens.length > 0 && tokens[0] === "\r") {
    tokens.shift();
  }
  return tokens;
}

/**
 * Creates a shared input session that routes prompts through @clack/prompts.
 * In a real TTY terminal, prompts use process.stdin directly with native raw-mode arrow keys.
 * In simulated/piped streams, tokens are queued and fed sequentially.
 */
export function createSharedInputSession(inputStream = process.stdin) {
  const isRealTty = Boolean(
    inputStream === process.stdin &&
      Boolean(inputStream?.isTTY) &&
      typeof inputStream.setRawMode === "function"
  );

  const tokenQueue = [];
  let streamClosed =
    Boolean(inputStream?.readableEnded) || Boolean(inputStream?.writableEnded);
  let activePrompt = null;

  const pumpActivePrompt = () => {
    if (!activePrompt || activePrompt.finished) return;

    const { kind, promptInput, abortController, options } = activePrompt;

    if (kind === "text" || kind === "password") {
      while (!activePrompt.finished && tokenQueue.length > 0) {
        const tok = tokenQueue.shift();
        if (tok === "\x03") {
          activePrompt.finished = true;
          activePrompt.caughtCtrlC = true;
          promptInput.write("\x03");
          return;
        }
        if (tok === "\r") {
          activePrompt.finished = true;
          promptInput.write("\r");
          return;
        }
        promptInput.write(tok);
      }
    } else if (kind === "select" || kind === "multiselect") {
      while (!activePrompt.finished && tokenQueue.length > 0) {
        const nextTok = tokenQueue[0];
        if (
          !nextTok.startsWith("\x1b") &&
          nextTok !== "\r" &&
          nextTok !== "\x03" &&
          nextTok !== " "
        ) {
          const returnIdx = tokenQueue.indexOf("\r");
          if (returnIdx === -1 && !streamClosed) {
            break;
          }
          const sliceEnd = returnIdx === -1 ? tokenQueue.length : returnIdx;
          const word = tokenQueue
            .slice(0, sliceEnd)
            .join("")
            .trim()
            .toLowerCase();
          tokenQueue.splice(
            0,
            returnIdx === -1 ? tokenQueue.length : returnIdx + 1
          );
          if (Array.isArray(options) && options.length > 0) {
            let matchIdx = options.findIndex(
              (o) => String(o.value).toLowerCase() === word
            );
            if (matchIdx === -1) {
              const num = Number(word) - 1;
              if (Number.isInteger(num) && num >= 0 && num < options.length) {
                matchIdx = num;
              }
            }
            if (matchIdx > 0) {
              promptInput.write("\x1b[B".repeat(matchIdx));
            }
          }
          activePrompt.finished = true;
          promptInput.write("\r");
          return;
        }

        const tok = tokenQueue.shift();
        if (tok === "\x03") {
          activePrompt.finished = true;
          activePrompt.caughtCtrlC = true;
          promptInput.write("\x03");
          return;
        }
        if (tok === "\r") {
          activePrompt.finished = true;
          promptInput.write("\r");
          return;
        }
        promptInput.write(tok);
      }
    } else if (kind === "confirm") {
      while (!activePrompt.finished && tokenQueue.length > 0) {
        const tok = tokenQueue.shift();
        if (tok === "\x03") {
          activePrompt.finished = true;
          activePrompt.caughtCtrlC = true;
          promptInput.write("\x03");
          return;
        }
        if (tok === "\r") {
          activePrompt.finished = true;
          promptInput.write("\r");
          return;
        }
        if (tok.toLowerCase() === "y" || tok.toLowerCase() === "n") {
          const wantYes = tok.toLowerCase() === "y";
          while (
            tokenQueue.length > 0 &&
            tokenQueue[0] !== "\r" &&
            !tokenQueue[0].startsWith("\x1b") &&
            tokenQueue[0] !== "\x03"
          ) {
            tokenQueue.shift();
          }
          if (tokenQueue.length > 0 && tokenQueue[0] === "\r") {
            tokenQueue.shift();
          }
          if (activePrompt.currentConfirmVal !== wantYes) {
            promptInput.write("\x1b[C");
            activePrompt.currentConfirmVal = wantYes;
          }
          activePrompt.finished = true;
          promptInput.write("\r");
          return;
        }
        if (
          tok === "\x1b[A" ||
          tok === "\x1b[B" ||
          tok === "\x1b[C" ||
          tok === "\x1b[D"
        ) {
          activePrompt.currentConfirmVal = !activePrompt.currentConfirmVal;
          promptInput.write(tok);
        }
      }
    }

    if (!activePrompt.finished && tokenQueue.length === 0 && streamClosed) {
      activePrompt.finished = true;
      activePrompt.abortedOnEof = true;
      abortController.abort();
    }
  };

  const onData = (chunk) => {
    const str = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    tokenQueue.push(...tokenizeInputChunk(str));
    pumpActivePrompt();
  };

  const onEnd = () => {
    streamClosed = true;
    pumpActivePrompt();
  };

  const onSigInt = () => {
    tokenQueue.push("\x03");
    pumpActivePrompt();
  };

  if (!isRealTty) {
    inputStream.on("data", onData);
    inputStream.on("end", onEnd);
    inputStream.on("close", onEnd);
    process.once("SIGINT", onSigInt);
  }

  const runClack = async (kind, buildPrompt, meta = {}) => {
    const p = await clackPromise;
    const promptInput = new PassThrough();
    const abortController = new AbortController();
    const promptChunks = [];
    const trackedOut = new PassThrough();
    trackedOut.on("data", (c) => {
      const s = Buffer.isBuffer(c) ? c.toString("utf8") : String(c);
      promptChunks.push(s);
      if (meta.outputStream) {
        meta.outputStream.write(s);
      }
    });

    activePrompt = {
      kind,
      promptInput,
      abortController,
      options: meta.options,
      currentConfirmVal: Boolean(meta.initialValue),
      finished: false,
      caughtCtrlC: false,
      abortedOnEof: false,
    };

    const promise = buildPrompt(p, {
      input: promptInput,
      output: trackedOut,
      signal: abortController.signal,
    });

    pumpActivePrompt();

    const value = await promise;
    const stateSnapshot = activePrompt;
    activePrompt = null;

    const rendered = applyAnsiToScreenLines(promptChunks);
    const promptLines = Math.max(0, rendered.split("\n").length - 1);

    return {
      value,
      isCancel: p.isCancel(value),
      caughtCtrlC: stateSnapshot.caughtCtrlC,
      abortedOnEof: stateSnapshot.abortedOnEof,
      promptLines,
    };
  };

  return {
    inputStream,
    tokenQueue,
    isRealTty,
    drainBufferedStdin: (discardAllQueued = false) => {
      if (isRealTty) {
        if (typeof inputStream.read === "function") {
          while (inputStream.read() !== null) {}
        }
        return;
      }
      if (typeof inputStream.pause === "function") {
        inputStream.pause();
      }
      const drainedChunks = [];
      if (typeof inputStream.read === "function") {
        let chunk;
        while ((chunk = inputStream.read()) !== null) {
          drainedChunks.push(
            Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
          );
        }
      }
      const preEnded =
        streamClosed ||
        Boolean(inputStream.readableEnded) ||
        Boolean(inputStream.writableEnded);
      if (!preEnded || discardAllQueued) {
        tokenQueue.length = 0;
      } else {
        if (drainedChunks.length > 0) {
          const text = Buffer.concat(drainedChunks).toString("utf8");
          tokenQueue.push(...tokenizeInputChunk(text));
        }
        while (tokenQueue.length > 0 && tokenQueue[0] === "\r") {
          tokenQueue.shift();
        }
      }
      if (typeof inputStream.resume === "function") {
        inputStream.resume();
      }
    },
    promptRawText: async ({
      message,
      placeholder,
      defaultValue,
      outputStream,
    }) => {
      const p = await clackPromise;
      if (isRealTty) {
        const val = await p.text({
          message,
          placeholder,
          defaultValue,
        });
        const isCanceled = p.isCancel(val);
        return {
          value: val,
          isCancel: isCanceled,
          caughtCtrlC: isCanceled,
          abortedOnEof: false,
          promptLines: 3,
        };
      }
      return runClack(
        "text",
        (pr, io) =>
          pr.text({
            message,
            placeholder,
            defaultValue,
            ...io,
          }),
        { outputStream }
      );
    },
    promptText: async ({
      message,
      defaultValue = "",
      summaryLabel,
      outputStream,
    }) => {
      const p = await clackPromise;
      if (isRealTty) {
        const val = await p.text({
          message,
          placeholder: defaultValue || undefined,
          defaultValue: defaultValue || undefined,
        });
        if (p.isCancel(val)) {
          throw new Error("Setup interrupted (Ctrl+C).");
        }
        const finalVal = String(val ?? "").trim() || defaultValue;
        if (outputStream && (outputStream.isTTY || process.env.FORCE_ANSI === "1")) {
          outputStream.write("\x1b[3A\r\x1b[0J");
        }
        if (outputStream) {
          const label = summaryLabel || message;
          outputStream.write(`${GREEN}✔${RESET} ${label}: ${finalVal}\n`);
        }
        return finalVal;
      }

      const res = await runClack(
        "text",
        (pr, io) =>
          pr.text({
            message,
            placeholder: defaultValue || undefined,
            defaultValue: defaultValue || undefined,
            ...io,
          }),
        { outputStream }
      );
      if (res.caughtCtrlC) {
        throw new Error("Setup interrupted (Ctrl+C).");
      }
      const finalVal = res.isCancel
        ? defaultValue
        : String(res.value ?? "").trim() || defaultValue;
      if (outputStream && res.promptLines > 0) {
        outputStream.write(`\x1b[${res.promptLines}A\r\x1b[0J`);
      }
      if (outputStream) {
        const label = summaryLabel || message;
        outputStream.write(`${GREEN}✔${RESET} ${label}: ${finalVal}\n`);
      }
      return finalVal;
    },
    promptConfirm: async ({
      message,
      initialValue = false,
      summaryLabel,
      formatSummaryValue,
      outputStream,
    }) => {
      const p = await clackPromise;
      if (isRealTty) {
        const val = await p.confirm({
          message,
          initialValue,
        });
        if (p.isCancel(val)) {
          throw new Error("Setup interrupted (Ctrl+C).");
        }
        const finalVal = Boolean(val);
        if (outputStream && (outputStream.isTTY || process.env.FORCE_ANSI === "1")) {
          outputStream.write("\x1b[3A\r\x1b[0J");
        }
        if (outputStream) {
          const label = summaryLabel || message;
          const valStr = formatSummaryValue
            ? formatSummaryValue(finalVal)
            : finalVal
              ? "yes"
              : "no";
          outputStream.write(`${GREEN}✔${RESET} ${label}: ${valStr}\n`);
        }
        return finalVal;
      }

      const res = await runClack(
        "confirm",
        (pr, io) =>
          pr.confirm({
            message,
            initialValue,
            ...io,
          }),
        { outputStream, initialValue }
      );
      if (res.caughtCtrlC) {
        throw new Error("Setup interrupted (Ctrl+C).");
      }
      const finalVal = res.isCancel ? Boolean(initialValue) : Boolean(res.value);
      if (outputStream && res.promptLines > 0) {
        outputStream.write(`\x1b[${res.promptLines}A\r\x1b[0J`);
      }
      if (outputStream) {
        const label = summaryLabel || message;
        const valStr = formatSummaryValue
          ? formatSummaryValue(finalVal)
          : finalVal
            ? "yes"
            : "no";
        outputStream.write(`${GREEN}✔${RESET} ${label}: ${valStr}\n`);
      }
      return finalVal;
    },
    promptSelect: async ({
      message,
      options,
      initialValue,
      summaryLabel,
      formatSummaryValue,
      defaultOnCancel,
      outputStream,
    }) => {
      const p = await clackPromise;
      if (isRealTty) {
        const val = await p.select({
          message,
          options,
          initialValue: initialValue ?? options[0]?.value,
        });
        if (p.isCancel(val)) {
          if (defaultOnCancel !== undefined) {
            return defaultOnCancel;
          }
          throw new Error("Setup interrupted (Ctrl+C).");
        }
        if (outputStream && (outputStream.isTTY || process.env.FORCE_ANSI === "1")) {
          outputStream.write("\x1b[3A\r\x1b[0J");
        }
        if (outputStream) {
          const label = summaryLabel || message;
          const valStr = formatSummaryValue
            ? formatSummaryValue(val)
            : String(val);
          outputStream.write(`${GREEN}✔${RESET} ${label}: ${valStr}\n`);
        }
        return val;
      }

      const res = await runClack(
        "select",
        (pr, io) =>
          pr.select({
            message,
            options,
            initialValue: initialValue ?? options[0]?.value,
            ...io,
          }),
        { outputStream, options }
      );
      if (res.caughtCtrlC) {
        throw new Error("Setup interrupted (Ctrl+C).");
      }
      const finalVal = res.isCancel
        ? (defaultOnCancel ?? initialValue ?? options[0]?.value)
        : res.value;
      if (outputStream && res.promptLines > 0) {
        outputStream.write(`\x1b[${res.promptLines}A\r\x1b[0J`);
      }
      if (outputStream) {
        const label = summaryLabel || message;
        const valStr = formatSummaryValue
          ? formatSummaryValue(finalVal)
          : String(finalVal);
        outputStream.write(`${GREEN}✔${RESET} ${label}: ${valStr}\n`);
      }
      return finalVal;
    },
    close: () => {
      if (!isRealTty) {
        process.removeListener("SIGINT", onSigInt);
        inputStream.removeListener("data", onData);
        inputStream.removeListener("end", onEnd);
        inputStream.removeListener("close", onEnd);
      }
    },
  };
}

/**
 * Displays the Admin Setup Token box + warning, prompts for `saved` via @clack/prompts,
 * re-displays on wrong input, erases the entire section via ANSI escapes
 * (with console.clear() fallback when not a TTY), replaces it with
 * `✔ Admin token saved.`, zeroes out the token Buffer, and marks the token confirmed in DB.
 */
