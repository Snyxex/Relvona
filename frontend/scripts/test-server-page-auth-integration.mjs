import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const standaloneServer = fileURLToPath(
  new URL("../.next/standalone/server.js", import.meta.url),
);

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  return address.port;
}

async function reservePort() {
  const server = createServer();
  const port = await listen(server);
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

const authServer = createServer((request, response) => {
  const cookie = request.headers.cookie || "";
  if (request.url !== "/api/v1/auth/me" || !cookie.includes("valid-")) {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Authentication required" }));
    return;
  }

  const isPlatformAdmin = cookie.includes("valid-admin");
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      user: {
        id: isPlatformAdmin ? "admin-1" : "user-1",
        isPlatformAdmin,
      },
    }),
  );
});

const authPort = await listen(authServer);
const frontendPort = await reservePort();
let output = "";
const frontend = spawn(process.execPath, [standaloneServer], {
  cwd: projectRoot,
  env: {
    ...process.env,
    HOSTNAME: "127.0.0.1",
    PORT: String(frontendPort),
    INTERNAL_API_URL: `http://127.0.0.1:${authPort}/api/v1`,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
frontend.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
frontend.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

const baseUrl = `http://127.0.0.1:${frontendPort}`;

async function waitUntilReady() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (frontend.exitCode !== null) {
      throw new Error(`Next.js exited before becoming ready:\n${output}`);
    }
    try {
      const response = await fetch(baseUrl, { redirect: "manual" });
      if (response.status === 200) return;
    } catch {
      // The server may still be binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Next.js did not become ready:\n${output}`);
}

async function request(path, cookie, extraHeaders = {}) {
  return fetch(`${baseUrl}${path}`, {
    headers: { ...(cookie ? { cookie } : {}), ...extraHeaders },
    redirect: "manual",
  });
}

try {
  await waitUntilReady();

  for (const cookie of [
    undefined,
    "supportai.session_token=",
    "unrelated=value",
    "supportai.session_token=junk",
    "__Secure-supportai.session_token=junk",
  ]) {
    const response = await request("/admin", cookie);
    assert.equal(response.status, 307);
    assert.equal(
      new URL(response.headers.get("location"), baseUrl).pathname,
      "/",
    );
    const body = await response.text();
    assert(!/PLATTFORMADMINISTRATOR|Software verwalten/.test(body));
  }

  const forgedHeaders = await request(
    "/admin",
    "supportai.session_token=junk",
    {
      "x-relvona-page-session": "authenticated",
      "x-relvona-platform-admin": "true",
    },
  );
  assert.equal(forgedHeaders.status, 307);

  const rsc = await request("/admin", "supportai.session_token=junk", {
    rsc: "1",
    "next-router-prefetch": "1",
  });
  assert.equal(rsc.status, 307);
  assert(!/PLATTFORMADMINISTRATOR|Software verwalten/.test(await rsc.text()));

  const regularAdmin = await request(
    "/admin",
    "supportai.session_token=valid-user",
  );
  assert.equal(regularAdmin.status, 307);
  assert.equal(
    new URL(regularAdmin.headers.get("location"), baseUrl).pathname,
    "/",
  );

  for (const cookie of [
    "supportai.session_token=valid-admin",
    "__Secure-supportai.session_token=valid-admin",
  ]) {
    assert.equal((await request("/admin", cookie)).status, 200);
  }

  assert.equal(
    (await request("/profile", "supportai.session_token=junk")).status,
    307,
  );
  assert.equal(
    (await request("/profile", "supportai.session_token=valid-user")).status,
    200,
  );

  console.log("Next.js page authentication integration: 12 cases passed.");
} finally {
  frontend.kill();
  await Promise.race([
    once(frontend, "exit"),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (frontend.exitCode === null) frontend.kill("SIGKILL");
  await new Promise((resolve) => authServer.close(resolve));
}
