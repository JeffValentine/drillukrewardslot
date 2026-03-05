const app = document.getElementById("app");
const spinBtn = document.getElementById("spinBtn");
const skipBtn = document.getElementById("skipBtn");
const closeBtn = document.getElementById("closeBtn");
const brandText = document.getElementById("brandText");
const resultText = document.getElementById("resultText");
const rarityPill = document.getElementById("rarityPill");
const tickerText = document.getElementById("tickerText");
const stickerField = document.getElementById("stickerField");
const volumeSlider = document.getElementById("volumeSlider");
const volumeValue = document.getElementById("volumeValue");
const fx = document.getElementById("fx");
const ctx = fx.getContext("2d");

let state = {
  open: false,
  spinning: false,
  payload: null,
  reelEls: [],
  strips: [],
  stripData: [],
  pool: [],
  result: null,
  allowCloseAt: 0,
};

const SYMBOL_HEIGHT = 92;
const SELECTOR_CENTER = 94;
let spinSession = null;
let audioCtx = null;
let noiseBuffer = null;
let spinAudio = null;
let masterGain = null;
let masterVolume = 0.4;
let activeDropAudio = null;
let dropCatalog = [];
let dropCatalogPromise = null;
const DROP_FILES = Array.from({ length: 10 }, (_, i) => encodeURI(`assets/audio/Drill Slots ${i + 1}.mp3`));

function nuiPost(name, data = {}) {
  // If not running inside FiveM NUI, just ignore
  if (typeof GetParentResourceName !== "function") return Promise.resolve();

  return fetch(`https://${GetParentResourceName()}/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  }).catch(() => {});
}

function resizeFx() {
  fx.width = app.clientWidth;
  fx.height = app.clientHeight;
}
window.addEventListener("resize", resizeFx);

function setTheme(theme) {
  if (!theme) return;
  document.documentElement.style.setProperty("--neon", theme.neon || "#b538ca");
  document.documentElement.style.setProperty("--neon2", theme.neon2 || "#77119a");
  document.documentElement.style.setProperty("--ink", theme.ink || "#140818");
  document.documentElement.style.setProperty("--fog", theme.fog || "#2f1338");
}

function setMotionState({ spinning = false, win = false } = {}) {
  app.classList.toggle("is-spinning", spinning);
  app.classList.toggle("is-win", win);
  app.classList.toggle("is-anticipation", false);
}

function triggerImpact() {
  app.classList.remove("is-impact");
  // Force reflow so repeated wins retrigger animation.
  void app.offsetWidth;
  app.classList.add("is-impact");
  setTimeout(() => app.classList.remove("is-impact"), 300);
}

function setVolume(value01) {
  masterVolume = Math.max(0, Math.min(1, value01));
  if (masterGain && audioCtx) {
    const now = audioCtx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(masterVolume, now + 0.06);
  }
  if (activeDropAudio) activeDropAudio.volume = masterVolume;
  if (volumeValue) volumeValue.textContent = `${Math.round(masterVolume * 100)}%`;
}

function seedStickers(pool = []) {
  if (!stickerField) return;
  const icons = pool.map((p) => (p.icon || "").trim()).filter(Boolean);
  const fallback = ["💷", "📦", "🎟️", "🚗", "⛓️", "🛠️", "👑"];
  const source = icons.length ? icons : fallback;
  stickerField.innerHTML = "";
  for (let i = 0; i < 22; i++) {
    const s = document.createElement("span");
    s.className = "sticker";
    s.textContent = source[Math.floor(Math.random() * source.length)];
    s.style.left = `${Math.random() * 100}%`;
    s.style.top = `${-20 - Math.random() * 80}px`;
    s.style.animationDuration = `${7 + Math.random() * 7}s`;
    s.style.animationDelay = `${-Math.random() * 10}s`;
    s.style.fontSize = `${16 + Math.random() * 22}px`;
    stickerField.appendChild(s);
  }
}

async function ensureAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (!masterGain) {
    masterGain = audioCtx.createGain();
    masterGain.gain.value = masterVolume;
    masterGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === "suspended") {
    try { await audioCtx.resume(); } catch (_) {}
  }
  if (!noiseBuffer) {
    noiseBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 1.0, audioCtx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.8;
  }
  return audioCtx;
}

function loadDropMetadata(src) {
  return new Promise((resolve) => {
    const a = new Audio(src);
    a.preload = "metadata";
    const done = () => {
      const duration = Number.isFinite(a.duration) ? a.duration : 0;
      resolve({ src, duration });
    };
    a.addEventListener("loadedmetadata", done, { once: true });
    a.addEventListener("error", () => resolve({ src, duration: 0 }), { once: true });
    a.load();
  });
}

async function getDropCatalog() {
  if (dropCatalog.length) return dropCatalog;
  if (!dropCatalogPromise) {
    dropCatalogPromise = Promise.all(DROP_FILES.map(loadDropMetadata)).then((items) => {
      dropCatalog = items.filter((i) => i.duration > 0);
      return dropCatalog;
    });
  }
  return dropCatalogPromise;
}

function stopDropAudio() {
  if (!activeDropAudio) return;
  activeDropAudio.pause();
  activeDropAudio.currentTime = 0;
  activeDropAudio = null;
}

async function startDropAudio() {
  stopDropAudio();
  const catalog = await getDropCatalog();
  if (!catalog.length) return null;
  const pick = catalog[Math.floor(Math.random() * catalog.length)];
  const audio = new Audio(pick.src);
  audio.preload = "auto";
  audio.volume = masterVolume;
  try {
    activeDropAudio = audio;
    await audio.play();
  } catch (_) {
    activeDropAudio = null;
    return null;
  }
  return { audio, duration: pick.duration };
}

function playKick(when, intensity = 1) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(160, when);
  osc.frequency.exponentialRampToValueAtTime(46, when + 0.14);
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(0.35 * intensity, when + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.17);
  osc.connect(gain).connect(masterGain || audioCtx.destination);
  osc.start(when);
  osc.stop(when + 0.2);
}

function playSnare(when, intensity = 1) {
  if (!audioCtx || !noiseBuffer) return;
  const src = audioCtx.createBufferSource();
  const filter = audioCtx.createBiquadFilter();
  const gain = audioCtx.createGain();
  src.buffer = noiseBuffer;
  filter.type = "highpass";
  filter.frequency.value = 1200;
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(0.12 * intensity, when + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.12);
  src.connect(filter).connect(gain).connect(masterGain || audioCtx.destination);
  src.start(when);
  src.stop(when + 0.14);
}

function playBeatDrop(rarity = "common") {
  if (!audioCtx) return;
  const now = audioCtx.currentTime + 0.02;
  const intensityMap = { common: 0.75, uncommon: 0.88, rare: 1.0, epic: 1.15, legendary: 1.3 };
  const intensity = intensityMap[rarity] || 1.0;
  playKick(now, intensity);
  playKick(now + 0.23, intensity * 0.9);
  playSnare(now + 0.13, intensity);
  playSnare(now + 0.36, intensity * 0.9);

  const bass = audioCtx.createOscillator();
  const bassGain = audioCtx.createGain();
  bass.type = "triangle";
  bass.frequency.setValueAtTime(58, now);
  bass.frequency.exponentialRampToValueAtTime(44, now + 0.24);
  bass.frequency.exponentialRampToValueAtTime(34, now + 0.46);
  bassGain.gain.setValueAtTime(0.0001, now);
  bassGain.gain.exponentialRampToValueAtTime(0.16 * intensity, now + 0.04);
  bassGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.52);
  bass.connect(bassGain).connect(masterGain || audioCtx.destination);
  bass.start(now);
  bass.stop(now + 0.55);
}

function startSpinAudio() {
  if (!audioCtx) return;
  stopSpinAudio();
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const filter = audioCtx.createBiquadFilter();
  const wobble = audioCtx.createOscillator();
  const wobbleGain = audioCtx.createGain();

  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(92, now);
  osc.frequency.linearRampToValueAtTime(64, now + 3.4);
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(850, now);
  filter.frequency.linearRampToValueAtTime(420, now + 3.2);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.05, now + 0.14);
  wobble.type = "sine";
  wobble.frequency.value = 8.5;
  wobbleGain.gain.value = 3.2;
  wobble.connect(wobbleGain).connect(osc.frequency);

  osc.connect(filter).connect(gain).connect(masterGain || audioCtx.destination);
  osc.start(now);
  wobble.start(now);
  spinAudio = { osc, gain, wobble };
}

function stopSpinAudio() {
  if (!audioCtx || !spinAudio) return;
  const now = audioCtx.currentTime;
  spinAudio.gain.gain.cancelScheduledValues(now);
  spinAudio.gain.gain.setValueAtTime(Math.max(spinAudio.gain.gain.value, 0.0001), now);
  spinAudio.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
  spinAudio.osc.stop(now + 0.1);
  spinAudio.wobble.stop(now + 0.1);
  spinAudio = null;
}

function rarityStyle(r) {
  const map = {
    common:   { text: "COMMON",   glow: 0.18 },
    uncommon: { text: "UNCOMMON", glow: 0.28 },
    rare:     { text: "RARE",     glow: 0.38 },
    epic:     { text: "EPIC",     glow: 0.52 },
    legendary:{ text: "LEGENDARY",glow: 0.70 },
  };
  return map[(r || "common").toLowerCase()] || map.common;
}

function buildReels(pool, opts = {}) {
  const totalSymbols = Math.max(90, opts.totalSymbols || 90);
  const startIndexBase = opts.startIndexBase || 54;
  state.pool = pool;
  state.reelEls = [...document.querySelectorAll(".reel")];
  state.strips = state.reelEls.map(r => r.querySelector(".strip"));
  state.stripData = [];

  for (let reelIndex = 0; reelIndex < state.strips.length; reelIndex++) {
    const strip = state.strips[reelIndex];
    strip.innerHTML = "";
    const repeated = [];
    for (let i = 0; i < totalSymbols; i++) {
      const s = pool[Math.floor(Math.random() * pool.length)];
      repeated.push(s);
    }
    for (const s of repeated) {
      const div = document.createElement("div");
      div.className = "symbol";
      div.innerHTML = `<span>${(s.icon || "").trim() || "🎁"}</span><small>${s.label || "Item"}</small>`;
      strip.appendChild(div);
    }
    const startIdx = Math.max(12, startIndexBase - reelIndex * 4);
    const startY = SELECTOR_CENTER - startIdx * SYMBOL_HEIGHT;
    strip.style.transform = `translateY(${startY}px)`;
    state.stripData.push({ symbols: repeated, y: startY, index: startIdx });
  }
}

function setReadout(reward) {
  const rs = rarityStyle(reward.rarity);
  rarityPill.textContent = rs.text;
  rarityPill.style.boxShadow = `0 0 22px rgba(181,56,202,${rs.glow})`;
  resultText.textContent = reward.label || reward.id;
}

function easeOutCubic(t){ return 1 - Math.pow(1 - t, 3); }

function sparkBurst(x, y, count, power) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = (0.6 + Math.random() * 1.0) * power;
    parts.push({
      x, y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      life: 0.9 + Math.random() * 0.6,
      r: 2 + Math.random() * 2
    });
  }
  return parts;
}

let particles = [];
function fxLoop() {
  requestAnimationFrame(fxLoop);
  if (!state.open) return;

  ctx.clearRect(0,0,fx.width,fx.height);

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= 0.016;
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.985;
    p.vy *= 0.985;
    p.vy += 0.01;

    const alpha = Math.max(0, Math.min(1, p.life));
    ctx.globalAlpha = alpha * 0.9;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(181,56,202,1)";
    ctx.shadowBlur = 18;
    ctx.shadowColor = "rgba(181,56,202,0.9)";
    ctx.fill();
    ctx.shadowBlur = 0;

    if (p.life <= 0) particles.splice(i, 1);
  }
  ctx.globalAlpha = 1;
}
fxLoop();

function centerOfMachine() {
  const machine = document.querySelector(".machine").getBoundingClientRect();
  const appRect = app.getBoundingClientRect();
  return {
    x: (machine.left - appRect.left) + machine.width * 0.5,
    y: (machine.top - appRect.top) + machine.height * 0.45
  };
}

function getRewardIcon(reward) {
  const map = {
    cash_small: "💷",
    cash_med: "💷",
    cash_big: "💷",
    car_token: "🎟️",
    drill_crate: "📦",
  };
  return map[reward.id] || "👑";
}

function getRewardSymbol(reward, reelPool = []) {
  const icon = getRewardIcon(reward);
  const fromPool = reelPool.find((item) => (item.icon || "").trim() === icon);
  return {
    icon,
    label: reward.label || fromPool?.label || reward.id || "Reward",
  };
}

function putSymbolAt(stripEl, index, symbol) {
  const nodes = [...stripEl.querySelectorAll(".symbol")];
  if (index < 0 || index >= nodes.length) return;
  const iconNode = nodes[index].querySelector("span");
  const textNode = nodes[index].querySelector("small");
  if (iconNode) iconNode.textContent = (symbol.icon || "").trim() || "🎁";
  if (textNode) textNode.textContent = symbol.label || "Reward";
}

function yForIndex(index) {
  return SELECTOR_CENTER - index * SYMBOL_HEIGHT;
}

function spinProgressCurve(t) {
  // Fast launch + long deceleration tail, closer to modern online slots feel.
  const eased = 1 - Math.pow(1 - t, 3.8);
  return Math.min(1, eased);
}

async function spin() {
  if (state.spinning || !state.payload?.reward) return;
  await ensureAudio();
  const drop = await startDropAudio();
  finished = false;
  state.spinning = true;
  setMotionState({ spinning: true, win: false });
  if (!drop) startSpinAudio();
  spinBtn.disabled = true;
  closeBtn.disabled = true;
  resultText.textContent = "Spinning...";
  rarityPill.textContent = "REWARD";
  rarityPill.style.boxShadow = "none";

  const reward = state.payload.reward;
  const rewardSymbol = getRewardSymbol(reward, state.payload.reelPool || []);

  const spinDur = Math.max(2200, Math.round((drop?.duration || 2.6) * 1000));
  const symbolsPerSecond = 31 + Math.random() * 5;
  const baseTravelSteps = Math.max(90, Math.round((spinDur / 1000) * symbolsPerSecond));
  const totalSymbols = Math.max(220, baseTravelSteps + 180);
  const startIndexBase = totalSymbols - 96;
  buildReels(state.payload.reelPool, { totalSymbols, startIndexBase });

  const start = performance.now();
  const reelStopFractions = [0.72, 0.86, 1.0];
  const startYs = state.stripData.map(d => d.y);
  const targetYs = [];
  const targetIndexes = [];
  const prevYs = [...startYs];
  let prevNow = start;

  for (let i = 0; i < state.strips.length; i++) {
    const strip = state.strips[i];
    const data = state.stripData[i];
    const stepDown = baseTravelSteps + (i * 18) + Math.floor(Math.random() * 16);
    const targetIdx = Math.max(4, data.index - stepDown);
    putSymbolAt(strip, targetIdx, rewardSymbol);
    targetYs.push(yForIndex(targetIdx));
    targetIndexes.push(targetIdx);
  }

  spinSession = { reward, rewardSymbol, targetYs, targetIndexes, rafId: null, spinDur, audio: drop?.audio || null };
  if (spinSession.audio) {
    spinSession.audio.addEventListener("ended", () => finishSpin(false), { once: true });
    spinSession.audio.addEventListener("error", () => finishSpin(false), { once: true });
  }

  let lastTick = 0;

  function animate(now) {
    if (!spinSession) return;
    const elapsed = spinSession.audio
      ? spinSession.audio.currentTime * 1000
      : (now - start);
    const total = spinSession.audio
      ? Math.max(1, (Number.isFinite(spinSession.audio.duration) ? spinSession.audio.duration : spinDur / 1000) * 1000)
      : spinDur;
    const t = Math.min(1, elapsed / total);
    app.classList.toggle("is-anticipation", t > 0.74 && t < 1);

    const machine = document.querySelector(".machine");
    const pulse = 1 + Math.sin(t * Math.PI * 3.2) * (0.005 + (t > 0.75 ? 0.006 : 0.002));
    const jitterX = t < 0.17 ? (Math.random() - 0.5) * 2.4 : 0;
    machine.style.transform = `translateX(${jitterX.toFixed(2)}px) scale(${pulse})`;
    tickerText.textContent = t > 0.9 ? "LOCKING REELS..." : t > 0.74 ? "ANTICIPATION BUILDING..." : "SPINNING HOT...";
    const dt = Math.max(16, now - prevNow);

    for (let i = 0; i < state.strips.length; i++) {
      const strip = state.strips[i];
      const stopAt = reelStopFractions[i];
      const localT = Math.min(1, t / stopAt);
      const e = spinProgressCurve(localT);
      const startY = startYs[i];
      const endY = targetYs[i];
      const y = startY + (endY - startY) * e;
      strip.style.transform = `translateY(${y}px)`;
      state.stripData[i].y = y;
      const speedPxPerSec = Math.abs(y - prevYs[i]) * (1000 / dt);
      const blurPx = Math.max(0, Math.min(7.5, speedPxPerSec / 1150));
      strip.style.filter = `blur(${blurPx.toFixed(2)}px) saturate(${(1 + blurPx * 0.06).toFixed(2)})`;
      prevYs[i] = y;
    }
    prevNow = now;

    const tickGap = t > 0.82 ? 52 : t > 0.6 ? 68 : 90;
    if (now - lastTick > tickGap) {
      lastTick = now;
      nuiPost("haptic", { kind: "tick" });
      const c = centerOfMachine();
      particles.push(...sparkBurst(c.x, c.y, t > 0.8 ? 16 : 8, t > 0.8 ? 3.2 : 2.2));
    }

    const audioFinished = !!(spinSession.audio && spinSession.audio.ended);
    const hardTimeout = (now - start) >= (total - 1000);
    if (audioFinished || hardTimeout) {
      finishSpin(false);
    } else if (t < 1 || spinSession.audio) {
      spinSession.rafId = requestAnimationFrame(animate);
    } else {
      finishSpin(false);
    }
  }

  spinSession.rafId = requestAnimationFrame(animate);
  skipBtn.onclick = () => finishSpin(true);
}

let finished = false;
function finishSpin(forced = false) {
  if (!spinSession) return;
  if (finished) return;
  finished = true;

  if (spinSession.rafId) cancelAnimationFrame(spinSession.rafId);
  const reward = spinSession.reward;

  for (let i = 0; i < state.strips.length; i++) {
    const y = spinSession.targetYs[i];
    state.strips[i].style.transform = `translateY(${y}px)`;
    state.strips[i].style.filter = "none";
    state.stripData[i].y = y;
    const nodes = state.strips[i].querySelectorAll(".symbol");
    const winNode = nodes[spinSession.targetIndexes[i]];
    if (winNode) {
      winNode.classList.add("hit-symbol");
      setTimeout(() => winNode.classList.remove("hit-symbol"), 900);
    }
  }

  const r = (reward.rarity || "common").toLowerCase();
  const c = centerOfMachine();
  const power = r === "legendary" ? 6.2 : r === "epic" ? 4.8 : r === "rare" ? 3.6 : 2.6;
  const count = r === "legendary" ? 120 : r === "epic" ? 90 : r === "rare" ? 70 : 48;

  particles.push(...sparkBurst(c.x, c.y, count, power));
  stopSpinAudio();
  if (forced) stopDropAudio();
  if (!spinSession.audio || forced) playBeatDrop(r);
  triggerImpact();
  setMotionState({ spinning: false, win: true });
  setTimeout(() => setMotionState({ spinning: false, win: false }), 520);
  nuiPost("haptic", { kind: (r === "legendary" || r === "epic") ? "bigwin" : "win" });
  setReadout(reward);
  tickerText.textContent = `${reward.label || reward.id} WON - DRILL-UK PAYOUT CONFIRMED`;

  state.spinning = false;
  spinBtn.disabled = false;
  closeBtn.disabled = false;
  state.allowCloseAt = Date.now() + (forced ? 250 : 650);

  nuiPost("spinComplete", {
    rewardId: reward.id,
    label: reward.label,
    rarity: reward.rarity,
    amount: reward.amount || 0
  });

  if (spinSession.audio && activeDropAudio === spinSession.audio) activeDropAudio = null;
  spinSession = null;
}

function openUI(payload) {
  finished = false;
  state.payload = payload;
  state.result = payload.reward;

  setTheme(payload.theme);
  brandText.textContent = payload.brand || "DRILL-UK";

  app.classList.remove("hidden");
  setMotionState({ spinning: false, win: false });
  state.open = true;
  resizeFx();
  seedStickers(payload.reelPool || []);
  getDropCatalog();

  buildReels(payload.reelPool || []);
  rarityPill.textContent = "REWARD";
  rarityPill.style.boxShadow = "none";
  resultText.textContent = "Press SPIN";
  tickerText.textContent = "DRILL-UK LIVE JACKPOT STREAM ACTIVE";
  setVolume(masterVolume);

  state.allowCloseAt = Date.now() + 350;
}

function closeUI() {
  if (!state.open) return;
  if (Date.now() < state.allowCloseAt) return;
  if (spinSession?.rafId) cancelAnimationFrame(spinSession.rafId);
  spinSession = null;
  stopSpinAudio();
  stopDropAudio();
  setMotionState({ spinning: false, win: false });

  app.classList.add("hidden");
  state.open = false;
  state.spinning = false;
  particles = [];
  nuiPost("close", {});
}

spinBtn.addEventListener("click", spin);
skipBtn.addEventListener("click", () => finishSpin(true));
closeBtn.addEventListener("click", closeUI);
if (volumeSlider) {
  volumeSlider.value = String(Math.round(masterVolume * 100));
  volumeSlider.addEventListener("input", () => setVolume(Number(volumeSlider.value) / 100));
  setVolume(Number(volumeSlider.value) / 100);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeUI();
});

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || !msg.action) return;

  if (msg.action === "open") openUI(msg.payload);
});
// ===== Browser test mode (remove when testing inside FiveM) =====
openUI({
  brand: "DRILL-UK",
  theme: { neon: "#b538ca", neon2: "#77119a", ink: "#140818", fog: "#2f1338" },
  reward: { id: "cash_big", label: "£50,000", rarity: "rare", amount: 50000 },
  reelPool: [
    { id:"cash",  label:"Cash",  icon:"💷" },
    { id:"crate", label:"Crate", icon:"📦" },
    { id:"token", label:"Token", icon:"🎟️" },
    { id:"car",   label:"Car",   icon:"🚗" },
    { id:"chain", label:"Chain", icon:"⛓️" },
    { id:"drill", label:"Drill", icon:"🛠️" },
    { id:"crown", label:"Crown", icon:"👑" }
  ]
});
