import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  createApiLimiter,
  createLoginLimiter,
  createRegistrationLimiter,
} from "./rate-limits.js";

async function fixture(t) {
  const app = express();
  app.use(express.json());
  app.use("/api", createApiLimiter());
  app.post("/api/login", createLoginLimiter(), (req, res) =>
    res.status(req.body.password === "correct" ? 200 : 401).json({}),
  );
  app.get("/api/products", (_req, res) => res.json([]));
  app.get("/api/products/:id/image", (_req, res) => res.send("image"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  return {
    get: async (path) => {
      const res = await fetch(base + path);
      await res.arrayBuffer();
      return res;
    },
    login: async (username, password = "wrong") => {
      const res = await fetch(base + "/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      return {
        status: res.status,
        headers: res.headers,
        body: await res.json(),
      };
    },
  };
}

test("public registration limits attempts per IP", async (t) => {
  const app = express();
  app.post("/register", createRegistrationLimiter(), (_req, res) =>
    res.status(201).json({}),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/register`;
  for (let i = 0; i < 10; i++) {
    const response = await fetch(url, { method: "POST" });
    assert.equal(response.status, 201);
    await response.json();
  }
  const blocked = await fetch(url, { method: "POST" });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  await blocked.json();
});

test("failed logins block only the same normalized username and IP", async (t) => {
  const api = await fixture(t);
  for (let i = 0; i < 8; i++)
    assert.equal((await api.login(" ADMIN ")).status, 401);
  const blocked = await api.login("admin", "correct");
  assert.equal(blocked.status, 429);
  assert.ok(blocked.body.retryAfter > 0 && blocked.body.retryAfter <= 900);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  assert.equal((await api.login("funcionario", "correct")).status, 200);
});

test("successful logins do not consume the failure allowance", async (t) => {
  const api = await fixture(t);
  for (let i = 0; i < 12; i++)
    assert.equal((await api.login("admin", "correct")).status, 200);
  for (let i = 0; i < 8; i++)
    assert.equal((await api.login("admin")).status, 401);
  assert.equal((await api.login("admin")).status, 429);
});

test("catalog images do not exhaust the API; API exhaustion does not block login", async (t) => {
  const api = await fixture(t);
  for (let i = 0; i < 510; i++)
    assert.equal((await api.get("/products/1/image")).status, 200);
  for (let i = 0; i < 500; i++)
    assert.equal((await api.get("/products")).status, 200);
  assert.equal((await api.get("/products")).status, 429);
  assert.equal((await api.get("/products/1/image")).status, 200);
  assert.equal((await api.login("admin", "correct")).status, 200);
});
