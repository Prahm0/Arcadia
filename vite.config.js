import { sites } from "@openai/sites-vite-plugin";
import { defineConfig } from "vite";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

class DevD1Statement {
  constructor(sqlite, sql) { this.sqlite = sqlite; this.sql = sql; this.values = []; }
  bind(...values) { this.values = values; return this; }
  async run() { const result = this.sqlite.prepare(this.sql).run(...this.values); return { success: true, meta: { changes: Number(result.changes) } }; }
  async all() { return { results: this.sqlite.prepare(this.sql).all(...this.values) }; }
  async first() { return this.sqlite.prepare(this.sql).get(...this.values) || null; }
}

class DevD1 {
  constructor() {
    const directory = resolve(".local"); mkdirSync(directory, { recursive: true });
    this.sqlite = new DatabaseSync(resolve(directory, "arcadia.sqlite")); this.sqlite.exec("PRAGMA foreign_keys = ON");
  }
  prepare(sql) { return new DevD1Statement(this.sqlite, sql); }
  async batch(statements) {
    this.sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

class DevR2 {
  constructor() { this.objects = new Map(); }
  async put(key, value, options = {}) {
    const bytes = value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(await new Response(value).arrayBuffer());
    this.objects.set(key, { bytes, httpMetadata: options.httpMetadata || {}, customMetadata: options.customMetadata || {} });
  }
  async get(key) {
    const object = this.objects.get(key);
    return object ? { body: object.bytes, size: object.bytes.byteLength, httpMetadata: object.httpMetadata, customMetadata: object.customMetadata } : null;
  }
  async delete(key) { this.objects.delete(key); }
}

function arcadiaDevWorker() {
  const DB = new DevD1();
  const FILES = new DevR2();
  return {
    name: "arcadia-dev-worker",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (incoming, outgoing, next) => {
        const path = (incoming.url || "/").split("?")[0];
        if (!(path === "/" || path === "/dashboard" || path === "/dashboard.js" || path === "/auth.js" || ["/login", "/register", "/forgot-password", "/reset-password", "/verify-email"].includes(path) || path === "/lucide-icons.js" || path.startsWith("/api/") || /\.(?:png)$/.test(path))) return next();
        try {
          const origin = `http://${incoming.headers.host || "127.0.0.1:5173"}`;
          const body = ["GET", "HEAD"].includes(incoming.method || "GET") ? undefined : Buffer.concat(await readBody(incoming));
          const request = new Request(new URL(incoming.url || "/", origin), {
            method: incoming.method, headers: incoming.headers, body, duplex: body ? "half" : undefined
          });
          const module = await server.ssrLoadModule("/worker/index.js");
          const pending = [];
          const response = await module.default.fetch(request, {
            DB, FILES,
            OPENAI_API_KEY: process.env.OPENAI_API_KEY,
            OPENAI_MODEL: process.env.OPENAI_MODEL,
            GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
            GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
            GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
            TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY
            ,RESEND_API_KEY: process.env.RESEND_API_KEY
            ,RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL
            ,APP_ORIGIN: process.env.APP_ORIGIN
          }, { waitUntil(promise) { pending.push(Promise.resolve(promise)); } });
          outgoing.statusCode = response.status;
          for (const [name, value] of response.headers) outgoing.setHeader(name, value);
          outgoing.end(Buffer.from(await response.arrayBuffer()));
          Promise.allSettled(pending).catch(() => undefined);
        } catch (error) {
          server.config.logger.error(error?.stack || String(error));
          outgoing.statusCode = 500;
          outgoing.setHeader("content-type", "application/json; charset=utf-8");
          outgoing.end(JSON.stringify({ error: "Local Arcadia worker failed." }));
        }
      });
    }
  };
}

async function readBody(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return chunks;
}

export default defineConfig({
  plugins: [sites(), arcadiaDevWorker()],
  build: {
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    emptyOutDir: true,
    lib: {
      entry: "worker/index.js",
      fileName: () => "index.js",
      formats: ["es"],
    },
    outDir: "dist/server",
    target: "es2022",
  },
});
