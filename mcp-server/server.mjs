import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
const waitlistPath = join(here, "data", "waitlist.json");

const arcadiaContent = {
  name: "Arcadia",
  tagline: "Make room for more life.",
  description:
    "Arcadia brings plans, people, and small daily rituals into one calm place.",
  principles: ["presence", "perspective", "possibility"],
  ritual: [
    { number: "01", name: "Notice", prompt: "What is asking for your attention today?" },
    { number: "02", name: "Choose", prompt: "What would feel like a good next step?" },
    { number: "03", name: "Wander", prompt: "Where could a little curiosity lead you?" }
  ]
};

async function readWaitlist() {
  try {
    return JSON.parse(await readFile(waitlistPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function saveWaitlist(entries) {
  await mkdir(dirname(waitlistPath), { recursive: true });
  await writeFile(waitlistPath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

const server = new McpServer({
  name: "arcadia",
  version: "0.1.0"
});

server.registerTool(
  "get_arcadia_content",
  {
    description: "Return the core content used by the Arcadia landing page."
  },
  async () => ({
    content: [{ type: "text", text: JSON.stringify(arcadiaContent, null, 2) }]
  })
);

server.registerTool(
  "join_arcadia_waitlist",
  {
    description: "Add an email address to the local Arcadia waitlist.",
    inputSchema: {
      email: z.string().email().describe("The person's email address")
    }
  },
  async ({ email }) => {
    const normalizedEmail = email.trim().toLowerCase();
    const entries = await readWaitlist();

    if (entries.some((entry) => entry.email === normalizedEmail)) {
      return {
        content: [{ type: "text", text: "This email is already on the Arcadia waitlist." }]
      };
    }

    entries.push({ email: normalizedEmail, joinedAt: new Date().toISOString() });
    await saveWaitlist(entries);

    return {
      content: [{ type: "text", text: "You’re on the Arcadia waitlist — see you there." }]
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
