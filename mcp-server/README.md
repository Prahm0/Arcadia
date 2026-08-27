# Arcadia MCP server

This is the first backend-oriented scaffold for Arcadia. It exposes two MCP tools over stdio:

- `get_arcadia_content` returns the landing-page content model.
- `join_arcadia_waitlist` validates and stores an email in `data/waitlist.json`.

## Run

From this directory:

```bash
npm install
npm start
```

The server communicates over stdin/stdout, so logs should not be written to stdout.

## Next integration step

The current landing-page form is browser-only. To submit from `index.html`, we should add a small HTTP layer or connect the form to a hosted waitlist provider. MCP is intended for AI clients to call server tools; it is not itself a browser form endpoint.
