# Realtime Voice Agent

A ChatGPT-style voice assistant built on the **OpenAI Realtime API**. Talk to it in your browser, see a live transcript, and download the conversation. Each agent's behaviour is defined by a plain **Markdown file**, so you can create new agents without touching any code.

## Features

- Speech-to-speech voice conversation over WebRTC (low latency, barge-in supported)
- Apple-style UI: translucent glass surfaces, system font, light and dark mode
- Audio-reactive orb (idle, listening, thinking, speaking) that moves with your voice and the agent's
- Respects reduced-motion, reduced-transparency and high-contrast settings
- Live transcript of both sides, with download as `.md`
- Mute, voice selection, and agent selection from the UI
- Add or edit agents by dropping `.md` files into `instructions/`, with no restart needed
- API key stays on the server; the browser only gets a short-lived key

## How it works

```
Browser (public/)                Server (server.js)              OpenAI
─────────────────                ──────────────────              ──────
1. Load agent list  ───────────▶ GET /api/agents
                                 (reads instructions/*.md)
2. Click mic        ───────────▶ POST /api/session
                                 reads instructions/<agent>.md ─▶ POST /v1/realtime/client_secrets
                    ◀─────────── ephemeral key  ◀──────────────── (instructions baked into session)
3. WebRTC (mic + audio + events) ─────────────────────────────▶ POST /v1/realtime/calls
4. Transcript events (data channel) update the UI
```

1. The page asks the server which agents exist. The server lists the `.md` files in `instructions/`.
2. When you press the mic, the server reads the chosen file. It sends the file's text as the session `instructions` and gets back an **ephemeral client secret**.
3. The browser uses that key to open a WebRTC connection straight to OpenAI. Audio flows both ways, and events (transcripts, speech start/stop) arrive on a data channel.
4. `app.js` turns those events into the orb state and the transcript.

## Project structure

```
.
├── server.js            # Express server: agent list + ephemeral session
├── instructions/        # One .md file per agent (the "brain")
│   ├── assistant.md
│   └── support-agent.md
├── public/
│   ├── index.html       # UI
│   ├── style.css
│   └── app.js           # WebRTC + transcript logic
├── .env.example
└── package.json
```

## Getting started

**Requirements:** Node.js 20.6+ and an OpenAI API key with Realtime API access.

```bash
git clone <your-repo-url>
git cd open-ai-realtime
npm install
cp .env.example .env      # then set OPENAI_API_KEY
npm start
```

Open http://localhost:3000, choose an agent and a voice, allow microphone access, and tap the mic.

### Configuration (`.env`)

| Variable         | Default            | Description                    |
| ---------------- | ------------------ | ------------------------------ |
| `OPENAI_API_KEY` | none (required)    | Your OpenAI API key            |
| `REALTIME_MODEL` | `gpt-realtime-2.1` | Realtime model to use          |
| `PORT`           | `3000`             | Server port                    |

## Creating a new agent type

An agent is just a Markdown file. To create one:

1. Add a file to `instructions/`, for example `instructions/sales-agent.md`.
2. Write the instructions in it:

   ```markdown
   # Role
   You are a friendly sales assistant for Acme Co.

   # Style
   - Keep answers under two sentences.
   - Always ask about the customer's budget.

   # Rules
   - Never promise discounts.
   - If asked about something unrelated, politely redirect.
   ```
3. Refresh the page. `sales-agent` now shows up in the agent dropdown.

**Notes**

- The file name becomes the agent name. Use letters, numbers, `-`, `_` and spaces only.
- Files are read when a session starts, so edits apply on the next conversation. You don't need to restart the server.
- Tips for good instructions: define the role, tone, language, length of replies, and what to do when unsure. Spoken answers should be short and free of lists or markdown.

## Transcripts

The transcript panel fills in as you talk. User speech is transcribed with `gpt-4o-mini-transcribe` (set in `server.js`). Agent speech uses the model's own audio transcript. Press ⬇️ to download the conversation as a Markdown file, or **Clear** to reset the panel.

## Security notes

- Never expose `OPENAI_API_KEY` in frontend code. This project only sends the browser a short-lived client secret.
- Agent names are validated to prevent path traversal.
- Add authentication to `/api/session` before deploying publicly, so strangers can't run up your bill.

## Troubleshooting

- **Mic doesn't work:** use `localhost` or HTTPS, and allow microphone permission.
- **`Session failed` / 401:** check `OPENAI_API_KEY` and your Realtime API access.
- **Agent not listed:** the file must end in `.md` and sit directly in `instructions/`.

## Roadmap ideas

Function calling and tools, MCP servers, saving transcripts to a database, and per-agent voice settings.

## License

MIT

---

Built by **Nisal Gunawardhana**
