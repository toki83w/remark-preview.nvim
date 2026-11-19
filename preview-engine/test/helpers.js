// Shared helpers for the server tests (no tests in this file).
import { request as httpRequest } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Plain HTTP request to 127.0.0.1; the Host header can be overridden. */
export function request(port, path, { headers = {}, method = "GET" } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path, method, headers: { Host: `127.0.0.1:${port}`, ...headers } },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** Exchanges the token for the session cookie, like a browser opening the URL. */
export async function login(port, token) {
  const res = await request(port, `/?t=${token}`);
  const setCookie = res.headers["set-cookie"];
  if (res.status !== 302 || !setCookie) {
    throw new Error(`login failed with status ${res.status}`);
  }
  return setCookie[0].split(";")[0];
}

/** Opens a Server-Sent Events stream and collects the events it receives. */
export function openSse(port, path, headers = {}) {
  const events = [];
  const waiters = [];
  let buffer = "";
  let response = null;

  const ready = new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path, headers: { Host: `127.0.0.1:${port}`, ...headers } },
      (res) => {
        response = res;
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          buffer += chunk;
          let index;
          while ((index = buffer.indexOf("\n\n")) !== -1) {
            const block = buffer.slice(0, index);
            buffer = buffer.slice(index + 2);
            const event = { name: "message", data: null, id: null };
            for (const line of block.split("\n")) {
              if (line.startsWith("event: ")) event.name = line.slice(7);
              else if (line.startsWith("data: ")) event.data = JSON.parse(line.slice(6));
              else if (line.startsWith("id: ")) event.id = line.slice(4);
            }
            if (block.startsWith(":") || block.startsWith("retry:")) continue;
            events.push(event);
            for (const waiter of [...waiters]) waiter();
          }
        });
        resolve(res.statusCode);
      },
    );
    req.on("error", reject);
    req.end();
    response = { destroy: () => req.destroy() };
  });

  const take = (name) => {
    const index = events.findIndex((e) => e.name === name);
    return index === -1 ? null : events.splice(index, 1)[0];
  };

  return {
    ready,
    events,
    /** Resolves with the next event of that name, or rejects after timeoutMs. */
    next(name, timeoutMs = 3000) {
      return new Promise((resolve, reject) => {
        const check = () => {
          const event = take(name);
          if (event) {
            clearTimeout(timer);
            waiters.splice(waiters.indexOf(check), 1);
            resolve(event);
          }
        };
        const timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(check), 1);
          reject(new Error(`timed out waiting for "${name}" event`));
        }, timeoutMs);
        waiters.push(check);
        check();
      });
    },
    /** Resolves true when no event of that name arrives within waitMs. */
    async none(name, waitMs = 300) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return !events.some((e) => e.name === name);
    },
    close() {
      response.destroy();
    },
  };
}

/** A temporary directory removed by cleanup(). */
export function tempDir(prefix = "rp-test-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
