import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INSTRUCTIONS_DIR = path.join(__dirname, "instructions");
const MODEL = process.env.REALTIME_MODEL || "gpt-realtime-2.1";
const PORT = process.env.PORT || 3000;

if (!process.env.OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY (copy .env.example to .env, then run: npm start)");
  process.exit(1);
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Only plain names -> prevents path traversal
const safeName = (n) => /^[\w\- ]+$/.test(n || "");

// List available .md instruction files (read fresh each time = dynamic)
app.get("/api/agents", async (_req, res) => {
  const files = await fs.readdir(INSTRUCTIONS_DIR);
  res.json(files.filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)));
});

// Create ephemeral client secret, with instructions loaded from the chosen .md file
app.post("/api/session", async (req, res) => {
  try {
    const { agent, voice = "marin" } = req.body || {};
    if (!safeName(agent) || !safeName(voice)) return res.status(400).json({ error: "invalid agent" });
    const instructions = await fs.readFile(path.join(INSTRUCTIONS_DIR, `${agent}.md`), "utf8");

    const r = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: MODEL,
          instructions,
          audio: {
            input: { transcription: { model: "gpt-4o-mini-transcribe" } },
            output: { voice },
          },
        },
      })
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json({ key: data.value, model: MODEL });
  } catch (e) {
    res.status(e.code === "ENOENT" ? 404 : 500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
