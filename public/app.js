const $ = (id) => document.getElementById(id);
const orb = $("orb"), statusEl = $("status"), messages = $("messages");
let pc, dc, mic, live = false, muted = false;
const bubbles = new Map(); // item_id -> element

// --- audio-reactive orb: measure level of whoever is "talking" ---
let audioCtx, level = 0, raf;
function watchLevel(stream) {
  audioCtx ||= new AudioContext();
  audioCtx.resume();
  const src = audioCtx.createMediaStreamSource(stream);
  const node = audioCtx.createAnalyser();
  node.fftSize = 512;
  src.connect(node); // not connected to destination: measurement only
  return { node, src, buf: new Uint8Array(node.fftSize) };
}
const meters = {};
const rms = (m) => {
  m.node.getByteTimeDomainData(m.buf);
  let sum = 0;
  for (const v of m.buf) { const d = (v - 128) / 128; sum += d * d; }
  return Math.sqrt(sum / m.buf.length);
};
let state = "idle";
function tick() {
  const m = state === "speaking" ? meters.remote : state === "listening" && !muted ? meters.mic : null;
  const target = m ? Math.min(1, rms(m) * 5) : 0;
  level += (target - level) * (target > level ? 0.35 : 0.12); // fast attack, slow release
  orb.style.setProperty("--level", level.toFixed(3));
  raf = requestAnimationFrame(tick);
}
function stopMeters() {
  cancelAnimationFrame(raf);
  for (const k in meters) { meters[k].src.disconnect(); delete meters[k]; }
  level = 0; orb.style.setProperty("--level", 0);
}

function setState(next, text) {
  state = next;
  orb.className = "orb " + state;
  statusEl.textContent = text;
}

function addBubble(id, role, text) {
  messages.querySelector(".empty")?.remove();
  const el = document.createElement("div");
  el.className = "msg " + role;
  el.innerHTML = `<span class="txt"></span>`;
  el.querySelector(".txt").textContent = text;
  el.classList.toggle("pending", text === "…");
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
  bubbles.set(id, { el, role, text });
  $("download").disabled = false;
}

function setBubble(id, role, text) {
  const b = bubbles.get(id);
  if (!b) return addBubble(id, role, text);
  b.text = text;
  b.el.classList.toggle("pending", text === "…");
  b.el.querySelector(".txt").textContent = text;
  messages.scrollTop = messages.scrollHeight;
}

function handleEvent(ev) {
  switch (ev.type) {
    case "input_audio_buffer.speech_started":
      setState("listening", "Listening…"); break;
    case "input_audio_buffer.speech_stopped":
      setState("thinking", "Thinking…");
      break;
    case "input_audio_buffer.committed":
      addBubble(ev.item_id, "user", "…"); break;
    case "conversation.item.input_audio_transcription.completed":
      setBubble(ev.item_id, "user", ev.transcript.trim()); break;
    case "response.output_audio_transcript.delta": {
      const b = bubbles.get(ev.item_id);
      setBubble(ev.item_id, "agent", (b && b.text !== "…" ? b.text : "") + ev.delta);
      break;
    }
    case "response.output_audio_transcript.done":
      setBubble(ev.item_id, "agent", ev.transcript.trim()); break;
    case "output_audio_buffer.started":
      setState("speaking", "Speaking…"); break;
    case "output_audio_buffer.stopped":
    case "output_audio_buffer.cleared":
      setState("listening", "Listening…"); break;
    case "error":
      setState("idle", "Error: " + ev.error.message); break;
  }
}

async function start() {
  $("toggle").disabled = true;
  setState("thinking", "Connecting…");
  try {
    const r = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: $("agent").value, voice: $("voice").value }),
    });
    const s = await r.json();
    if (!r.ok) throw new Error(s.error?.message || s.error || "Session failed");

    pc = new RTCPeerConnection();
    pc.ontrack = (e) => {
      $("audio").srcObject = e.streams[0];
      meters.remote = watchLevel(e.streams[0]);
    };
    mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    meters.mic = watchLevel(mic);
    pc.addTrack(mic.getTracks()[0]);

    dc = pc.createDataChannel("oai-events");
    dc.onmessage = (e) => handleEvent(JSON.parse(e.data));
    dc.onopen = () => {
      live = true;
      $("toggle").classList.add("live"); $("toggle").setAttribute("aria-label", "End conversation");
      tick();
      $("toggle").disabled = false; $("mute").disabled = false;
      $("agent").disabled = $("voice").disabled = true;
      setState("listening", "Listening… just start talking");
    };
    dc.onclose = () => live && stop();

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const res = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST", body: offer.sdp,
      headers: { Authorization: `Bearer ${s.key}`, "Content-Type": "application/sdp" },
    });
    if (!res.ok) throw new Error("Realtime connection failed");
    await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
  } catch (e) {
    stop(); setState("idle", "Error: " + e.message);
  }
}

function stop() {
  live = false;
  dc?.close(); pc?.close(); mic?.getTracks().forEach((t) => t.stop());
  stopMeters();
  muted = false; $("mute").classList.remove("is-muted");
  $("toggle").classList.remove("live"); $("toggle").setAttribute("aria-label", "Start conversation");
  $("toggle").disabled = false; $("mute").disabled = true;
  $("agent").disabled = $("voice").disabled = false;
  setState("idle", "Tap the mic to start");
}

function toggleMute() {
  muted = !muted;
  mic.getAudioTracks().forEach((t) => (t.enabled = !muted));
  $("mute").classList.toggle("is-muted", muted);
  $("mute").setAttribute("aria-label", muted ? "Unmute microphone" : "Mute microphone");
  setState(muted ? "idle" : "listening", muted ? "Muted" : "Listening…");
}

function downloadTranscript() {
  const lines = [...bubbles.values()].map((b) => `${b.role === "user" ? "You" : "Agent"}: ${b.text}`);
  const header = `# Transcript - ${$("agent").value}\n${new Date().toLocaleString()}\n\n`;
  const blob = new Blob([header + lines.join("\n\n")], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `transcript-${Date.now()}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function clearTranscript() {
  bubbles.clear();
  messages.innerHTML = '<p class="empty">Your conversation will appear here.</p>';
  $("download").disabled = true;
}

async function loadAgents() {
  const list = await (await fetch("/api/agents")).json();
  $("agent").innerHTML = list.map((a) => `<option>${a}</option>`).join("");
}

$("toggle").onclick = () => (live ? stop() : start());
$("mute").onclick = toggleMute;
$("download").onclick = downloadTranscript;
$("clear").onclick = clearTranscript;
loadAgents();
