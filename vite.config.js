import { sites } from "@openai/sites-vite-plugin";
import { defineConfig } from "vite";
import { DatabaseSync } from "node:sqlite";

class DevD1Statement {
  constructor(statement) { this.statement = statement; this.values = []; }
  bind(...values) { this.values = values; return this; }
  async run() { const result = this.statement.run(...this.values); return { success: true, meta: { changes: Number(result.changes) } }; }
  async all() { return { results: this.statement.all(...this.values) }; }
  async first() { return this.statement.get(...this.values) || null; }
}

class DevD1 {
  constructor() { this.sqlite = new DatabaseSync(":memory:"); this.sqlite.exec("PRAGMA foreign_keys = ON"); }
  prepare(sql) { return new DevD1Statement(this.sqlite.prepare(sql)); }
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

function arcadiaDevWorker() {
  const DB = new DevD1();
  return {
    name: "arcadia-dev-worker",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (incoming, outgoing, next) => {
        const path = (incoming.url || "/").split("?")[0];
        if (!(path === "/" || path === "/dashboard" || path === "/dashboard.js" || path.startsWith("/api/") || /\.(?:png)$/.test(path))) return next();
        try {
          const origin = `http://${incoming.headers.host || "127.0.0.1:5173"}`;
          const body = ["GET", "HEAD"].includes(incoming.method || "GET") ? undefined : Buffer.concat(await readBody(incoming));
          const request = new Request(new URL(incoming.url || "/", origin), {
            method: incoming.method, headers: incoming.headers, body, duplex: body ? "half" : undefined
          });
          const module = await server.ssrLoadModule("/worker/index.js");
          const pending = [];
          const response = await module.default.fetch(request, {
            DB,
            OPENAI_API_KEY: process.env.OPENAI_API_KEY,
            OPENAI_MODEL: process.env.OPENAI_MODEL,
            GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
            GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
            GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
            TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY
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
