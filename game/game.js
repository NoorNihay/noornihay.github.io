/* =====================================================================
   SHADOWNET: DIGITAL GHOST  —  Case 001 "Voices of the Dead"
   A playable vertical slice of the full design.

   Systems implemented here (each is a hook for the larger game):
     - Top-down overworld exploration with tile collision + zone travel
     - NPC dialogue with branching + Social Engineering skill checks
     - Hacking mini-game (Firewall Breach)
     - Cyberspace combat (top-down twin-stick-lite shooter)
     - Investigation / Evidence Board deduction
     - Skill progression (5 trees), XP, levels, skill points
     - Faction reputation (Corporate / Ghost / Resistance)
     - Multiple case endings + localStorage save/load

   Rendering: the <canvas> draws world / hack / combat.
   The DOM overlays (index.html) draw all text UI.
   ===================================================================== */

(() => {
"use strict";

// ----------------------------------------------------------------------
// Constants & helpers
// ----------------------------------------------------------------------
const W = 800, H = 600, TILE = 40;
const SAVE_KEY = "shadownet_save_v1";

const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d");

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const dist = (x1, y1, x2, y2) => Math.hypot(x1 - x2, y1 - y2);
const now = () => performance.now();

function $(sel) { return document.querySelector(sel); }
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

// ----------------------------------------------------------------------
// Game state
// ----------------------------------------------------------------------
const SKILL_DEFS = [
  { id: "intrusion",  name: "Network Intrusion",  desc: "Stronger packet in Firewall Breach; faster breaches." },
  { id: "social",     name: "Social Engineering", desc: "Unlocks persuasive dialogue options." },
  { id: "forensics",  name: "Digital Forensics",  desc: "Reveals hidden clues others miss." },
  { id: "combat",     name: "Combat Programs",    desc: "Data Pistol deals more damage in cyberspace." },
  { id: "stealth",    name: "Stealth",            desc: "Take less damage; enemies are slower to react." },
];

function freshState() {
  return {
    zone: "rust",
    px: 120, py: 300,           // player position in current zone
    facing: 1,
    hp: 100, maxHp: 100,
    level: 1, xp: 0, xpNext: 100, sp: 1,
    skills: { intrusion: 1, social: 0, forensics: 0, combat: 1, stealth: 0 },
    rep: { corp: 0, ghost: 0, resist: 0 },
    clues: [],                  // array of clue ids discovered
    flags: {},                  // arbitrary story flags
    objective: "Find Sable in the Rust Sector and accept the case.",
    journal: [],                // {text, done}
    solved: false,
  };
}

let S = freshState();

// Journal objective tracking ------------------------------------------------
function setObjective(text) {
  S.objective = text;
  $("#objective").textContent = text;
}
function addJournal(text) {
  if (!S.journal.some(j => j.text === text)) S.journal.push({ text, done: false });
}
function completeJournal(text) {
  const j = S.journal.find(j => j.text === text);
  if (j) j.done = true;
}

// ----------------------------------------------------------------------
// Clue database
// ----------------------------------------------------------------------
const CLUES = {
  last_message: {
    title: "Eli's Last Message",
    body: "A text sent 3 days AFTER Eli Marrow's recorded death: 'They didn't let me go. I'm still in the Helix.'",
  },
  memory_fragment: {
    title: "Recovered Memory Fragment",
    body: "A corrupted neural backup. Geotag resolves to Helix Tower, Neon Heights. Timestamp matches Eli's 'death'.",
  },
  financial_record: {
    title: "Helix Financial Record",
    body: "Helix Corp funnels funds into 'Project Lazarus' — a consciousness-storage program. Eli was test subject L-09.",
  },
  voss_admission: {
    title: "Voss's Slip",
    body: "Director Voss admitted Lazarus subjects 'consented in spirit.' No signed consent exists for L-09.",
  },
  hidden_ledger: {
    title: "Hidden Forensic Ledger",
    body: "[Forensics] A buried log: 9 of 12 Lazarus subjects were declared dead BEFORE upload. They never agreed.",
  },
};

function hasClue(id) { return S.clues.includes(id); }
function giveClue(id) {
  if (hasClue(id)) return;
  S.clues.push(id);
  toast("CLUE ACQUIRED: " + CLUES[id].title, "good");
  save();
}

// ----------------------------------------------------------------------
// XP / leveling / reputation
// ----------------------------------------------------------------------
function gainXp(amount) {
  S.xp += amount;
  toast("+" + amount + " XP", "good");
  while (S.xp >= S.xpNext) {
    S.xp -= S.xpNext;
    S.level++;
    S.sp++;
    S.xpNext = Math.round(S.xpNext * 1.4);
    S.maxHp += 10; S.hp = S.maxHp;
    toast("LEVEL UP! Now level " + S.level + " (+1 skill point)", "good");
  }
  refreshHud();
  save();
}
function changeRep(faction, amount) {
  S.rep[faction] = clamp(S.rep[faction] + amount, -100, 100);
  const names = { corp: "Corporate", ghost: "Ghost Collective", resist: "Resistance" };
  toast((amount >= 0 ? "+" : "") + amount + " " + names[faction] + " reputation",
        amount >= 0 ? "good" : "warn");
  refreshHud();
}

function refreshHud() {
  $("#hp-fill").style.width = (S.hp / S.maxHp * 100) + "%";
  $("#xp-fill").style.width = (S.xp / S.xpNext * 100) + "%";
  $("#level-line").innerHTML = "LVL " + S.level + " &middot; <span id='sp-line'>" + S.sp + " SP</span>";
  $("#rep-corp").textContent = S.rep.corp;
  $("#rep-ghost").textContent = S.rep.ghost;
  $("#rep-resist").textContent = S.rep.resist;
}

// ----------------------------------------------------------------------
// Save / load
// ----------------------------------------------------------------------
function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) {}
}
function load() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    S = Object.assign(freshState(), JSON.parse(raw));
    return true;
  } catch (e) { return false; }
}
function hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch (e) { return false; } }

// ----------------------------------------------------------------------
// Toasts
// ----------------------------------------------------------------------
function toast(msg, kind) {
  const stack = $("#toast-stack");
  const t = el("div", "toast" + (kind === "good" ? "" : kind === "bad" ? " bad" : " warn"), msg);
  stack.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .4s"; }, 2600);
  setTimeout(() => t.remove(), 3100);
}

// ----------------------------------------------------------------------
// Input
// ----------------------------------------------------------------------
const keys = {};
const justPressed = {};
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (!keys[k]) justPressed[k] = true;
  keys[k] = true;
  if (["arrowup","arrowdown","arrowleft","arrowright"," "].includes(k)) e.preventDefault();
});
window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });
function consume(k) { if (justPressed[k]) { justPressed[k] = false; return true; } return false; }

const mouse = { x: 0, y: 0, down: false };
canvas.addEventListener("mousemove", (e) => {
  const r = canvas.getBoundingClientRect();
  mouse.x = (e.clientX - r.left) * (W / r.width);
  mouse.y = (e.clientY - r.top) * (H / r.height);
});
canvas.addEventListener("mousedown", () => mouse.down = true);
canvas.addEventListener("mouseup", () => mouse.down = false);

// --- Touch input -------------------------------------------------------
const touch = { moveX: 0, moveY: 0 };
const isTouch = ("ontouchstart" in window) || navigator.maxTouchPoints > 0;
if (isTouch) document.body.classList.add("touch");

function initTouchControls() {
  const root = document.getElementById("touch");
  root.classList.remove("hidden");

  // Virtual joystick
  const stick = document.getElementById("touch-stick");
  const nub = document.getElementById("touch-nub");
  const R = 45;
  let id = null, cx = 0, cy = 0;
  const setNub = (nx, ny) => nub.style.transform = `translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;
  function moveNub(e) {
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const len = Math.hypot(dx, dy) || 1;
    const m = Math.min(len, R), a = Math.atan2(dy, dx);
    const nx = Math.cos(a) * m, ny = Math.sin(a) * m;
    setNub(nx, ny);
    let vx = nx / R, vy = ny / R;
    if (Math.hypot(vx, vy) < 0.18) { vx = 0; vy = 0; }
    touch.moveX = vx; touch.moveY = vy;
  }
  stick.addEventListener("pointerdown", (e) => {
    id = e.pointerId;
    const r = stick.getBoundingClientRect();
    cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    stick.setPointerCapture(id); moveNub(e);
  });
  stick.addEventListener("pointermove", (e) => { if (e.pointerId === id) moveNub(e); });
  const release = (e) => { if (e.pointerId === id) { id = null; touch.moveX = touch.moveY = 0; setNub(0, 0); } };
  stick.addEventListener("pointerup", release);
  stick.addEventListener("pointercancel", release);

  // Action buttons -> feed the same justPressed queue the keyboard uses
  const bind = (sel, key) => {
    document.querySelector(sel).addEventListener("pointerdown", (e) => {
      e.preventDefault(); justPressed[key] = true;
    });
  };
  bind("#tc-interact", "e");
  bind("#tc-journal", "j");
  bind("#tc-board", "b");
  bind("#tc-skills", "k");
  bind("#tc-esc", "escape");

  // Combat aiming: touching the canvas aims + fires the Data Pistol
  const aim = (e) => {
    if (mode !== "combat") return;
    e.preventDefault();
    const t = e.changedTouches[0];
    const r = canvas.getBoundingClientRect();
    mouse.x = (t.clientX - r.left) * (W / r.width);
    mouse.y = (t.clientY - r.top) * (H / r.height);
    mouse.down = true;
  };
  canvas.addEventListener("touchstart", aim, { passive: false });
  canvas.addEventListener("touchmove", aim, { passive: false });
  canvas.addEventListener("touchend", () => { if (mode === "combat") mouse.down = false; }, { passive: false });
}
if (isTouch) initTouchControls();

// ----------------------------------------------------------------------
// World data — zones are tile grids (20 x 15). 1 = wall, 0 = floor.
// Objects (NPCs, terminals, exits) are placed separately in tile coords.
// ----------------------------------------------------------------------
const COLS = W / TILE, ROWS = H / TILE; // 20 x 15

function makeRoom(decorate) {
  const g = [];
  for (let y = 0; y < ROWS; y++) {
    const row = [];
    for (let x = 0; x < COLS; x++) {
      row.push((x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1) ? 1 : 0);
    }
    g.push(row);
  }
  if (decorate) decorate(g);
  return g;
}
function wall(g, x, y) { if (g[y] && g[y][x] !== undefined) g[y][x] = 1; }
function wallRect(g, x0, y0, x1, y1) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) wall(g, x, y); }

const ZONES = {
  rust: {
    name: "RUST SECTOR",
    tint: "#2a1a12",
    accent: "#ff8a3c",
    grid: makeRoom((g) => {
      wallRect(g, 4, 3, 6, 5);     // broken machinery
      wallRect(g, 13, 8, 16, 10);  // scrap pile
      wallRect(g, 8, 11, 11, 11);  // rubble
      wall(g, 9, 4); wall(g, 10, 4);
    }),
    npcs: [
      { id: "sable", name: "Sable", tx: 15, ty: 4, color: "#39ff8b", talk: "sableTalk" },
    ],
    terminals: [
      { id: "rust_terminal", tx: 5, ty: 7, color: "#19f0ff", label: "Recover Eli's memory file",
        action: "hackRustTerminal" },
    ],
    exits: [
      { tx: 19, ty: 7, to: "neon", spawnX: 90, spawnY: 300, label: "Neon Heights →" },
    ],
  },
  neon: {
    name: "NEON HEIGHTS",
    tint: "#0a1230",
    accent: "#19f0ff",
    grid: makeRoom((g) => {
      wallRect(g, 6, 2, 8, 4);
      wallRect(g, 11, 2, 13, 4);
      wallRect(g, 6, 10, 8, 12);
      wallRect(g, 11, 10, 13, 12);
      wallRect(g, 9, 6, 10, 8); // central pillar (Helix lobby)
    }),
    npcs: [
      { id: "voss", name: "Director Voss", tx: 10, ty: 4, color: "#ff2bd6", talk: "vossTalk" },
    ],
    terminals: [
      { id: "ice_node", tx: 4, ty: 7, color: "#ff3b5c", label: "Breach Helix ICE (combat)",
        action: "enterCombat" },
    ],
    exits: [
      { tx: 0, ty: 7, to: "rust", spawnX: 700, spawnY: 300, label: "← Rust Sector" },
    ],
  },
};

function zone() { return ZONES[S.zone]; }
function solid(tx, ty) {
  const g = zone().grid;
  if (ty < 0 || ty >= ROWS || tx < 0 || tx >= COLS) return true;
  return g[ty][tx] === 1;
}

// ----------------------------------------------------------------------
// Mode / state machine
//   "title" | "world" | "hack" | "combat" | "ending"
//   (dialogue/menus are DOM overlays that pause the world)
// ----------------------------------------------------------------------
let mode = "title";
let paused = false; // true while a DOM overlay (dialogue/menu) is open

// ======================================================================
// WORLD MODE
// ======================================================================
const PLAYER_SIZE = 22, PLAYER_SPEED = 2.6;

function nearestInteractable() {
  const z = zone();
  const cx = S.px, cy = S.py;
  let best = null, bestD = 60;
  const all = [
    ...z.npcs.map(n => ({ ...n, kind: "npc" })),
    ...z.terminals.map(t => ({ ...t, kind: "terminal" })),
    ...z.exits.map(e => ({ ...e, kind: "exit" })),
  ];
  for (const o of all) {
    const ox = o.tx * TILE + TILE / 2, oy = o.ty * TILE + TILE / 2;
    const d = dist(cx, cy, ox, oy);
    if (d < bestD) { bestD = d; best = { ...o, ox, oy }; }
  }
  return best;
}

function updateWorld() {
  if (paused) return;

  let dx = 0, dy = 0;
  if (keys["w"] || keys["arrowup"]) dy -= 1;
  if (keys["s"] || keys["arrowdown"]) dy += 1;
  if (keys["a"] || keys["arrowleft"]) dx -= 1;
  if (keys["d"] || keys["arrowright"]) dx += 1;
  dx += touch.moveX; dy += touch.moveY;
  if (dx || dy) {
    const len = Math.hypot(dx, dy);
    dx /= len; dy /= len;
    if (dx) S.facing = dx > 0 ? 1 : -1;
    movePlayer(dx * PLAYER_SPEED, dy * PLAYER_SPEED);
  }

  // Interactions
  const target = nearestInteractable();
  const prompt = $("#interact-prompt");
  if (target) {
    prompt.classList.remove("hidden");
    let label = target.kind === "npc" ? "Talk to " + target.name
      : target.kind === "exit" ? target.label
      : target.label;
    prompt.textContent = "[E] " + label;
    const r = canvas.getBoundingClientRect();
    prompt.style.left = (r.left + target.ox * (r.width / W)) + "px";
    prompt.style.top = (r.top + (target.oy - 24) * (r.height / H)) + "px";
    if (consume("e")) interact(target);
  } else {
    prompt.classList.add("hidden");
  }

  // Menus
  if (consume("j")) openMenu("journal");
  if (consume("b")) openMenu("board");
  if (consume("k")) openMenu("skills");
}

function movePlayer(vx, vy) {
  const half = PLAYER_SIZE / 2;
  // X axis
  let nx = S.px + vx;
  if (!collides(nx, S.py, half)) S.px = nx;
  // Y axis
  let ny = S.py + vy;
  if (!collides(S.px, ny, half)) S.py = ny;
  S.px = clamp(S.px, half + 2, W - half - 2);
  S.py = clamp(S.py, half + 2, H - half - 2);
}
function collides(cx, cy, half) {
  const pts = [
    [cx - half, cy - half], [cx + half, cy - half],
    [cx - half, cy + half], [cx + half, cy + half],
  ];
  for (const [x, y] of pts) {
    if (solid(Math.floor(x / TILE), Math.floor(y / TILE))) return true;
  }
  return false;
}

function interact(o) {
  if (o.kind === "exit") {
    travel(o);
  } else if (o.kind === "npc") {
    DIALOGUE[o.talk]();
  } else if (o.kind === "terminal") {
    ACTIONS[o.action](o);
  }
}

function travel(exit) {
  S.zone = exit.to;
  S.px = exit.spawnX; S.py = exit.spawnY;
  toast("Entered " + zone().name, "good");
  save();
}

// ----------------------------------------------------------------------
// World rendering
// ----------------------------------------------------------------------
let frame = 0;
function drawWorld() {
  const z = zone();
  // Floor
  ctx.fillStyle = z.tint;
  ctx.fillRect(0, 0, W, H);

  // Grid tiles
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const px = x * TILE, py = y * TILE;
      if (z.grid[y][x] === 1) {
        ctx.fillStyle = "#000";
        ctx.fillRect(px, py, TILE, TILE);
        ctx.strokeStyle = z.accent;
        ctx.globalAlpha = 0.5;
        ctx.strokeRect(px + 1.5, py + 1.5, TILE - 3, TILE - 3);
        ctx.globalAlpha = 1;
      } else {
        ctx.strokeStyle = "rgba(255,255,255,0.04)";
        ctx.strokeRect(px, py, TILE, TILE);
      }
    }
  }

  // Zone name watermark
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = z.accent;
  ctx.font = "bold 64px Courier New";
  ctx.textAlign = "center";
  ctx.fillText(z.name, W / 2, H / 2 + 20);
  ctx.restore();

  // Exits (glowing doorways)
  for (const e of z.exits) drawGlowTile(e.tx, e.ty, z.accent, "⇄");
  // Terminals
  for (const t of z.terminals) drawTerminal(t);
  // NPCs
  for (const n of z.npcs) drawNpc(n);

  // Player
  drawPlayer(S.px, S.py);

  // Scanline overlay
  drawScanlines();
}

function drawGlowTile(tx, ty, color, glyph) {
  const px = tx * TILE + TILE / 2, py = ty * TILE + TILE / 2;
  const pulse = 0.5 + 0.5 * Math.sin(frame * 0.08);
  ctx.save();
  ctx.shadowColor = color; ctx.shadowBlur = 14 + pulse * 10;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.25 + pulse * 0.25;
  ctx.fillRect(px - 16, py - 16, 32, 32);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#fff";
  ctx.font = "18px Courier New"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(glyph, px, py);
  ctx.restore();
}

function drawTerminal(t) {
  const px = t.tx * TILE + TILE / 2, py = t.ty * TILE + TILE / 2;
  const done = S.flags[t.id + "_done"];
  const color = done ? "#445" : t.color;
  ctx.save();
  ctx.shadowColor = color; ctx.shadowBlur = done ? 4 : 16;
  ctx.fillStyle = "#0a0e1a";
  ctx.fillRect(px - 13, py - 15, 26, 30);
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.strokeRect(px - 13, py - 15, 26, 30);
  ctx.fillStyle = color;
  ctx.fillRect(px - 9, py - 11, 18, 12); // screen
  ctx.fillStyle = "#000";
  ctx.font = "8px Courier New"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(done ? "OK" : ">_", px, py - 5);
  ctx.restore();
}

function drawNpc(n) {
  const px = n.tx * TILE + TILE / 2, py = n.ty * TILE + TILE / 2;
  const bob = Math.sin(frame * 0.06 + n.tx) * 2;
  ctx.save();
  ctx.shadowColor = n.color; ctx.shadowBlur = 12;
  // body
  ctx.fillStyle = n.color;
  ctx.fillRect(px - 8, py - 6 + bob, 16, 18);
  // head
  ctx.beginPath(); ctx.arc(px, py - 12 + bob, 7, 0, Math.PI * 2); ctx.fill();
  // name
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#fff"; ctx.font = "10px Courier New"; ctx.textAlign = "center";
  ctx.fillText(n.name, px, py - 24 + bob);
  ctx.restore();
}

function drawPlayer(px, py) {
  ctx.save();
  ctx.shadowColor = "#19f0ff"; ctx.shadowBlur = 14;
  // trench-coat body
  ctx.fillStyle = "#0e2a3a";
  ctx.fillRect(px - 10, py - 6, 20, 20);
  ctx.fillStyle = "#19f0ff";
  ctx.fillRect(px - 10, py - 6, 20, 4); // shoulders
  // head
  ctx.beginPath(); ctx.arc(px, py - 12, 7, 0, Math.PI * 2);
  ctx.fillStyle = "#10171f"; ctx.fill();
  // visor
  ctx.fillStyle = "#ff2bd6";
  ctx.fillRect(px - 5 + S.facing * 1, py - 14, 8, 3);
  ctx.restore();
}

function drawScanlines() {
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = "#000";
  for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
  ctx.restore();
}

// ======================================================================
// DIALOGUE SYSTEM
// ======================================================================
const dlgEl = $("#dialogue");
function showDialogue(speaker, text, choices) {
  paused = true;
  dlgEl.classList.remove("hidden");
  dlgEl.querySelector(".dlg-speaker").textContent = speaker;
  dlgEl.querySelector(".dlg-text").textContent = text;
  const box = dlgEl.querySelector(".dlg-choices");
  box.innerHTML = "";
  choices.forEach(c => {
    const locked = c.requires && S.skills[c.requires.skill] < c.requires.level;
    const b = el("button", "dlg-choice" + (c.skill ? " skill" : "") + (locked ? " locked" : ""));
    let label = c.text;
    if (c.skill) label += "<span class='tag'>[" + c.skill + "]</span>";
    if (locked) label += "<span class='tag'>🔒 " + c.requires.skill + " " + c.requires.level + "</span>";
    b.innerHTML = label;
    if (!locked) b.onclick = () => { if (c.action) c.action(); };
    box.appendChild(b);
  });
}
function closeDialogue() {
  dlgEl.classList.add("hidden");
  paused = false;
  refreshHud();
  save();
}

const DIALOGUE = {
  // --- Sable: the Resistance contact who gives Case 001 ---
  sableTalk() {
    if (!S.flags.case_started) {
      showDialogue("Sable", "You're the analyst who can hear them too, aren't you? The dead. Eli Marrow died three days ago — but he's still texting his sister. We need to know how. Will you take the case?", [
        { text: "I'm in. What do you have?", action: () => {
            S.flags.case_started = true;
            giveClue("last_message");
            addJournal("Recover Eli's memory file from the Rust terminal");
            addJournal("Travel to Neon Heights and breach Helix ICE");
            addJournal("Confront Director Voss");
            addJournal("Solve the case on the Evidence Board");
            setObjective("Hack the Rust terminal to recover Eli's memory file.");
            gainXp(20);
            DIALOGUE.sableTalk();
          } },
        { text: "Why come to me?", action: () => showDialogue("Sable",
            "Because Corporate owns every other analyst. You still answer to your conscience. That's rare in 2094.", [
            { text: "Tell me about the case.", action: () => DIALOGUE.sableTalk_force() },
          ]) },
      ]);
    } else if (!S.solved) {
      showDialogue("Sable", "Eli's memory file, the Helix money, Voss's lies — connect them on your evidence board. When you're sure who did this, decide what to do with the truth.", [
        { text: "I'm working on it.", action: closeDialogue },
        { text: "[Resistance] We could burn Helix to the ground.", skill: "Resist", action: () => {
            changeRep("resist", 5);
            showDialogue("Sable", "Now you're speaking my language. Get me proof and the Front will make Helix answer for it.", [
              { text: "Understood.", action: closeDialogue },
            ]);
          } },
      ]);
    } else {
      showDialogue("Sable", "You did it. Whatever you chose, the network will never be the same. Rest, Ghost. The next case is already waiting.", [
        { text: "Until next time.", action: closeDialogue },
      ]);
    }
  },
  sableTalk_force() {
    S.flags.case_started = true;
    giveClue("last_message");
    addJournal("Recover Eli's memory file from the Rust terminal");
    addJournal("Travel to Neon Heights and breach Helix ICE");
    addJournal("Confront Director Voss");
    addJournal("Solve the case on the Evidence Board");
    setObjective("Hack the Rust terminal to recover Eli's memory file.");
    gainXp(20);
    showDialogue("Sable", "Start with the terminal in this sector — Eli's last backup bounced through it. Recover the memory fragment, then follow it wherever it leads.", [
      { text: "On it.", action: closeDialogue },
    ]);
  },

  // --- Director Voss: Helix executive in Neon Heights ---
  vossTalk() {
    if (!hasClue("financial_record")) {
      showDialogue("Director Voss", "This is a restricted floor, analyst. Helix has nothing to hide. Run along before security escorts you out.", [
        { text: "I'll be back with proof.", action: closeDialogue },
      ]);
      return;
    }
    if (S.flags.voss_done) {
      showDialogue("Director Voss", "We're done talking. Whatever you think you have, Helix's lawyers will bury it.", [
        { text: "We'll see.", action: closeDialogue },
      ]);
      return;
    }
    showDialogue("Director Voss", "Project Lazarus? You've been busy. Those subjects consented in spirit — they wanted to live forever. We simply... obliged them.", [
      { text: "'In spirit'? Show me the signatures.", action: () => {
          giveClue("voss_admission");
          S.flags.voss_done = true;
          gainXp(25);
          showDialogue("Director Voss", "...This conversation is over.", [
            { text: "That's all I needed.", action: closeDialogue },
          ]);
        } },
      { text: "[Social Engineering] I can make this disappear — for a price.", skill: "Social",
        requires: { skill: "social", level: 1 }, action: () => {
          giveClue("voss_admission");
          changeRep("corp", 8);
          S.flags.voss_done = true;
          gainXp(40);
          showDialogue("Director Voss", "Smart. A pragmatist. Helix rewards pragmatists — remember that when you write your report.", [
            { text: "Oh, I'll remember.", action: closeDialogue },
          ]);
        } },
      { text: "[Forensics] I already found the buried ledger, Voss.", skill: "Forensics",
        requires: { skill: "forensics", level: 1 }, action: () => {
          giveClue("voss_admission");
          giveClue("hidden_ledger");
          gainXp(50);
          showDialogue("Director Voss", "Impossible. That log was scrubbed... How deep did you dig?", [
            { text: "Deep enough to end you.", action: closeDialogue },
          ]);
        } },
    ]);
  },
};

// ======================================================================
// ACTIONS (terminals)
// ======================================================================
const ACTIONS = {
  hackRustTerminal(o) {
    if (S.flags.rust_terminal_done) {
      toast("Already recovered. The fragment is on your board.", "warn");
      return;
    }
    startHack(() => {
      // success callback
      S.flags.rust_terminal_done = true;
      giveClue("memory_fragment");
      gainXp(30);
      completeJournal("Recover Eli's memory file from the Rust terminal");
      setObjective("Travel east to Neon Heights. Breach the Helix ICE node.");
      toast("Memory fragment recovered. Trail leads to Neon Heights.", "good");
    });
  },
  enterCombat(o) {
    if (S.flags.ice_node_done) {
      toast("ICE already shattered. Confront Voss.", "warn");
      return;
    }
    startCombat(() => {
      S.flags.ice_node_done = true;
      giveClue("financial_record");
      gainXp(45);
      completeJournal("Travel to Neon Heights and breach Helix ICE");
      setObjective("Confront Director Voss, then solve the case on your Evidence Board [B].");
      toast("ICE shattered. Helix financials exposed.", "good");
    });
  },
};

// ======================================================================
// HACKING MINI-GAME — "Firewall Breach"
// Guide your data packet UP the stream, dodge firewall blocks.
// Fill the breach meter to 100%. Network Intrusion skill helps.
// ======================================================================
const hack = {
  active: false, onWin: null,
  packetX: W / 2, integrity: 100, progress: 0,
  blocks: [], spawnT: 0,
};
function startHack(onWin) {
  mode = "hack";
  hack.active = true; hack.onWin = onWin;
  hack.packetX = W / 2; hack.integrity = 100; hack.progress = 0;
  hack.blocks = []; hack.spawnT = 0;
  $("#hud").classList.add("hidden");
  $("#interact-prompt").classList.add("hidden");
}
function endHack(won) {
  hack.active = false;
  mode = "world";
  $("#hud").classList.remove("hidden");
  if (won) { const cb = hack.onWin; hack.onWin = null; if (cb) cb(); }
  else toast("Breach failed — integrity lost. Try again.", "bad");
  save();
}
function updateHack() {
  const skill = S.skills.intrusion;
  const speedFactor = 1 - Math.min(skill, 4) * 0.08; // higher skill = slower obstacles
  const fillRate = 0.12 + skill * 0.02;

  // Move packet
  if (keys["a"] || keys["arrowleft"]) hack.packetX -= 5;
  if (keys["d"] || keys["arrowright"]) hack.packetX += 5;
  hack.packetX += touch.moveX * 5;
  hack.packetX = clamp(hack.packetX, 30, W - 30);

  // Progress
  hack.progress += fillRate;
  if (hack.progress >= 100) { endHack(true); return; }

  // Spawn blocks
  hack.spawnT--;
  if (hack.spawnT <= 0) {
    hack.spawnT = Math.max(22, 46 - skill * 3);
    const gap = 130 + skill * 8;
    const gapX = rand(80, W - 80 - gap);
    hack.blocks.push({ y: -30, gapX, gap, w: W });
  }
  // Move blocks down, collision
  const py = H - 70, half = 12;
  for (const b of hack.blocks) {
    b.y += 3.4 * speedFactor;
    if (b.y + 20 > py - half && b.y < py + half) {
      const inGap = hack.packetX > b.gapX && hack.packetX < b.gapX + b.gap;
      if (!inGap && !b.hit) {
        b.hit = true;
        hack.integrity -= 22 - S.skills.stealth * 2;
        toast("Firewall hit! Integrity " + Math.max(0, Math.round(hack.integrity)) + "%", "bad");
        if (hack.integrity <= 0) { endHack(false); return; }
      }
    }
  }
  hack.blocks = hack.blocks.filter(b => b.y < H + 40);

  if (consume("escape")) endHack(false);
}
function drawHack() {
  ctx.fillStyle = "#02060f"; ctx.fillRect(0, 0, W, H);
  // moving data-stream background
  ctx.strokeStyle = "rgba(25,240,255,0.08)";
  for (let x = 0; x < W; x += 20) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = "#0af";
  for (let i = 0; i < 30; i++) {
    const y = (frame * 4 + i * 60) % H;
    ctx.fillRect((i * 53) % W, y, 2, 14);
  }
  ctx.restore();

  // Firewall blocks (two segments leaving a gap)
  for (const b of hack.blocks) {
    ctx.fillStyle = b.hit ? "#ff3b5c" : "#ff2bd6";
    ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 10;
    ctx.fillRect(0, b.y, b.gapX, 20);
    ctx.fillRect(b.gapX + b.gap, b.y, W - (b.gapX + b.gap), 20);
    ctx.shadowBlur = 0;
  }

  // Packet
  const py = H - 70;
  ctx.save();
  ctx.shadowColor = "#39ff8b"; ctx.shadowBlur = 16;
  ctx.fillStyle = "#39ff8b";
  ctx.fillRect(hack.packetX - 12, py - 12, 24, 24);
  ctx.fillStyle = "#02060f"; ctx.font = "10px Courier New"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText("◈", hack.packetX, py);
  ctx.restore();

  // HUD
  ctx.fillStyle = "#19f0ff"; ctx.font = "bold 16px Courier New"; ctx.textAlign = "left";
  ctx.fillText("FIREWALL BREACH", 20, 30);
  ctx.font = "12px Courier New";
  ctx.fillText("Steer with A/D — pass through the gaps. [Esc] abort", 20, 50);
  // progress bar
  ctx.fillStyle = "rgba(255,255,255,0.1)"; ctx.fillRect(20, 64, W - 40, 12);
  ctx.fillStyle = "#39ff8b"; ctx.fillRect(20, 64, (W - 40) * hack.progress / 100, 12);
  ctx.strokeStyle = "#39ff8b"; ctx.strokeRect(20, 64, W - 40, 12);
  // integrity
  ctx.fillStyle = "#ff3b5c"; ctx.textAlign = "right";
  ctx.fillText("INTEGRITY " + Math.max(0, Math.round(hack.integrity)) + "%", W - 20, 30);
  ctx.textAlign = "left";
  drawScanlines();
}

// ======================================================================
// CYBERSPACE COMBAT — top-down shooter
// Move WASD, aim with mouse, click to fire your Data Pistol.
// Clear all malware to shatter the ICE. Combat/Stealth skills matter.
// ======================================================================
const combat = {
  active: false, onWin: null,
  x: W / 2, y: H / 2, hp: 100,
  bullets: [], enemies: [], fireCd: 0,
};
function startCombat(onWin) {
  mode = "combat";
  combat.active = true; combat.onWin = onWin;
  combat.x = W / 2; combat.y = H - 100; combat.hp = S.hp;
  combat.bullets = []; combat.enemies = []; combat.fireCd = 0;
  const count = 5;
  for (let i = 0; i < count; i++) {
    combat.enemies.push({
      x: rand(60, W - 60), y: rand(40, 180),
      hp: 30, r: 16, t: rand(0, 6),
    });
  }
  $("#hud").classList.add("hidden");
  $("#interact-prompt").classList.add("hidden");
}
function endCombat(won) {
  combat.active = false;
  mode = "world";
  S.hp = won ? Math.max(20, Math.round(combat.hp)) : Math.max(10, Math.round(combat.hp));
  $("#hud").classList.remove("hidden");
  refreshHud();
  if (won) { const cb = combat.onWin; combat.onWin = null; if (cb) cb(); }
  else toast("Connection severed — you were forced out. Re-enter to try again.", "bad");
  save();
}
function updateCombat() {
  const spd = 3.4;
  if (keys["w"] || keys["arrowup"]) combat.y -= spd;
  if (keys["s"] || keys["arrowdown"]) combat.y += spd;
  if (keys["a"] || keys["arrowleft"]) combat.x -= spd;
  if (keys["d"] || keys["arrowright"]) combat.x += spd;
  combat.x += touch.moveX * spd; combat.y += touch.moveY * spd;
  combat.x = clamp(combat.x, 16, W - 16);
  combat.y = clamp(combat.y, 16, H - 16);

  // Fire
  combat.fireCd--;
  if (mouse.down && combat.fireCd <= 0) {
    combat.fireCd = 10;
    const a = Math.atan2(mouse.y - combat.y, mouse.x - combat.x);
    combat.bullets.push({ x: combat.x, y: combat.y, vx: Math.cos(a) * 9, vy: Math.sin(a) * 9 });
  }
  // Bullets
  const dmg = 12 + S.skills.combat * 6;
  for (const b of combat.bullets) { b.x += b.vx; b.y += b.vy; }
  combat.bullets = combat.bullets.filter(b => b.x > -10 && b.x < W + 10 && b.y > -10 && b.y < H + 10);

  // Enemies chase + collide
  const enemySpeed = 1.1 - S.skills.stealth * 0.08;
  for (const e of combat.enemies) {
    e.t += 0.05;
    const a = Math.atan2(combat.y - e.y, combat.x - e.x);
    e.x += Math.cos(a) * enemySpeed + Math.cos(e.t) * 0.4;
    e.y += Math.sin(a) * enemySpeed;
    // bullet hits
    for (const b of combat.bullets) {
      if (dist(b.x, b.y, e.x, e.y) < e.r) { e.hp -= dmg; b.dead = true; }
    }
    // touch damage
    if (dist(combat.x, combat.y, e.x, e.y) < e.r + 12) {
      combat.hp -= (0.6 - S.skills.stealth * 0.05);
    }
  }
  combat.bullets = combat.bullets.filter(b => !b.dead);
  combat.enemies = combat.enemies.filter(e => e.hp > 0);

  if (combat.hp <= 0) { endCombat(false); return; }
  if (combat.enemies.length === 0) { endCombat(true); return; }
  if (consume("escape")) endCombat(false);
}
function drawCombat() {
  ctx.fillStyle = "#04010a"; ctx.fillRect(0, 0, W, H);
  // grid floor
  ctx.strokeStyle = "rgba(255,43,214,0.12)";
  for (let x = 0; x <= W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // enemies (malware)
  for (const e of combat.enemies) {
    ctx.save();
    ctx.shadowColor = "#ff3b5c"; ctx.shadowBlur = 12;
    ctx.fillStyle = "#ff3b5c";
    ctx.translate(e.x, e.y); ctx.rotate(e.t);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2, rr = i % 2 ? e.r : e.r * 0.6;
      ctx[i ? "lineTo" : "moveTo"](Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // bullets
  ctx.fillStyle = "#19f0ff"; ctx.shadowColor = "#19f0ff"; ctx.shadowBlur = 8;
  for (const b of combat.bullets) { ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, Math.PI * 2); ctx.fill(); }
  ctx.shadowBlur = 0;

  // player avatar
  ctx.save();
  ctx.translate(combat.x, combat.y);
  ctx.rotate(Math.atan2(mouse.y - combat.y, mouse.x - combat.x));
  ctx.shadowColor = "#39ff8b"; ctx.shadowBlur = 14;
  ctx.fillStyle = "#39ff8b";
  ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-10, -9); ctx.lineTo(-6, 0); ctx.lineTo(-10, 9); ctx.closePath(); ctx.fill();
  ctx.restore();

  // HUD
  ctx.fillStyle = "#ff2bd6"; ctx.font = "bold 16px Courier New"; ctx.textAlign = "left";
  ctx.fillText("CYBERSPACE COMBAT — HELIX ICE", 20, 30);
  ctx.font = "12px Courier New"; ctx.fillStyle = "#aef";
  ctx.fillText("Move WASD · aim + click to fire · clear all malware · [Esc] abort", 20, 50);
  ctx.fillText("Malware left: " + combat.enemies.length, 20, 70);
  // hp bar
  ctx.fillStyle = "rgba(255,255,255,0.1)"; ctx.fillRect(W - 220, 20, 200, 12);
  ctx.fillStyle = "#39ff8b"; ctx.fillRect(W - 220, 20, 200 * clamp(combat.hp, 0, 100) / 100, 12);
  ctx.strokeStyle = "#39ff8b"; ctx.strokeRect(W - 220, 20, 200, 12);
  ctx.fillStyle = "#39ff8b"; ctx.textAlign = "right"; ctx.fillText("INTEGRITY", W - 20, 16); ctx.textAlign = "left";
  drawScanlines();
}

// ======================================================================
// MENUS (Journal / Evidence Board / Skills)
// ======================================================================
const menuEl = $("#menu");
let currentTab = "journal";
function openMenu(tab) {
  paused = true;
  currentTab = tab;
  menuEl.classList.remove("hidden");
  renderMenu();
}
function closeMenu() {
  menuEl.classList.add("hidden");
  paused = false;
  save();
}
function renderMenu() {
  const tabs = menuEl.querySelector(".menu-tabs");
  tabs.innerHTML = "";
  [["journal", "JOURNAL"], ["board", "EVIDENCE"], ["skills", "SKILLS"]].forEach(([id, label]) => {
    const b = el("button", "menu-tab" + (currentTab === id ? " active" : ""), label);
    b.onclick = () => { currentTab = id; renderMenu(); };
    tabs.appendChild(b);
  });
  const body = menuEl.querySelector(".menu-body");
  body.innerHTML = "";
  if (currentTab === "journal") renderJournal(body);
  else if (currentTab === "board") renderBoard(body);
  else renderSkills(body);
}

function renderJournal(body) {
  body.appendChild(el("div", "journal-case", "CASE 001 — VOICES OF THE DEAD"));
  body.appendChild(el("p", null, S.flags.case_started
    ? "Eli Marrow is dead, yet messages still come from his account. Trace the signal to its source."
    : "No active case. Find Sable in the Rust Sector."));
  if (S.journal.length === 0) { body.appendChild(el("p", null, "<em>No objectives yet.</em>")); return; }
  S.journal.forEach(j => body.appendChild(el("div", "journal-obj" + (j.done ? " done" : ""), j.text)));
}

let boardSelection = [];
const SUSPECTS = ["— select culprit —", "Sable / The Resistance", "Director Voss / Helix Corp", "A rogue AI", "Eli faked his death"];
function renderBoard(body) {
  body.appendChild(el("p", null, "Select clues that fit together, then name who is keeping the dead in the network."));
  if (S.clues.length === 0) { body.appendChild(el("p", null, "<em>No clues collected. Investigate the world.</em>")); return; }

  S.clues.forEach(id => {
    const c = CLUES[id];
    const card = el("div", "clue-card" + (boardSelection.includes(id) ? " selected" : ""));
    card.appendChild(el("div", "clue-title", c.title));
    card.appendChild(el("div", "clue-body", c.body));
    card.onclick = () => {
      if (boardSelection.includes(id)) boardSelection = boardSelection.filter(x => x !== id);
      else boardSelection.push(id);
      renderMenu();
    };
    body.appendChild(card);
  });

  if (S.solved) { body.appendChild(el("p", "journal-case", "✓ CASE SOLVED")); return; }

  const row = el("div", "deduce-row");
  const sel = el("select");
  SUSPECTS.forEach((s, i) => { const o = el("option", null, s); o.value = i; sel.appendChild(o); });
  const btn = el("button", null, "CONNECT &amp; DEDUCE");
  btn.onclick = () => attemptDeduction(parseInt(sel.value, 10));
  row.appendChild(el("span", null, "Culprit:"));
  row.appendChild(sel);
  row.appendChild(btn);
  body.appendChild(row);
  body.appendChild(el("p", null, "<small>Selected " + boardSelection.length + " clue(s). The right call connects the memory fragment, the Helix money, and Voss's words.</small>"));
}

function attemptDeduction(suspect) {
  const needed = ["memory_fragment", "financial_record", "voss_admission"];
  const hasNeeded = needed.every(id => boardSelection.includes(id));
  const correctSuspect = suspect === 2; // Director Voss / Helix Corp

  if (correctSuspect && hasNeeded) {
    S.solved = true;
    completeJournal("Solve the case on the Evidence Board");
    gainXp(80);
    toast("Deduction confirmed: Helix Corp / Director Voss.", "good");
    closeMenu();
    chooseCaseResolution();
  } else if (!hasNeeded) {
    toast("Not enough connected evidence. Select the key clues.", "warn");
  } else {
    toast("That accusation doesn't fit the evidence. An innocent could be arrested.", "bad");
    changeRep("resist", -3);
  }
}

function renderSkills(body) {
  body.appendChild(el("div", "sp-banner", "Skill Points available: " + S.sp));
  SKILL_DEFS.forEach(def => {
    const row = el("div", "skill-row");
    const info = el("div", "skill-info");
    info.appendChild(el("div", "skill-name", def.name));
    info.appendChild(el("div", "skill-desc", def.desc));
    const lvl = S.skills[def.id];
    info.appendChild(el("div", "skill-pips", "◆".repeat(lvl) + "◇".repeat(5 - lvl)));
    const buy = el("button", "skill-buy", "+");
    buy.disabled = S.sp <= 0 || lvl >= 5;
    buy.onclick = () => {
      if (S.sp > 0 && S.skills[def.id] < 5) {
        S.skills[def.id]++; S.sp--;
        toast(def.name + " → level " + S.skills[def.id], "good");
        if (def.id === "intrusion" || def.id === "combat" || def.id === "stealth")
          { /* combat/hack tuned live from skill values */ }
        renderMenu(); refreshHud(); save();
      }
    };
    row.appendChild(info);
    row.appendChild(buy);
    body.appendChild(row);
  });
}

// ======================================================================
// CASE RESOLUTION + ENDINGS
// ======================================================================
function chooseCaseResolution() {
  paused = true;
  dlgEl.classList.remove("hidden");
  dlgEl.querySelector(".dlg-speaker").textContent = "DECISION";
  dlgEl.querySelector(".dlg-text").textContent =
    "You have the truth: Helix Corp trapped Eli Marrow's consciousness in Project Lazarus without consent. What do you do with it?";
  const box = dlgEl.querySelector(".dlg-choices");
  box.innerHTML = "";
  const choices = [
    { text: "Hand the proof to the Resistance — burn Helix down. <span class='tag'>Freedom</span>",
      action: () => endGame("freedom") },
    { text: "Sell your silence to Helix. <span class='tag'>Corporate</span>",
      action: () => endGame("corporate") },
    { text: "Release the trapped minds into the open network. <span class='tag'>Ghost</span>",
      action: () => endGame("ghost") },
  ];
  if (hasClue("hidden_ledger")) {
    choices.push({ text: "[Forensics] Expose ALL 12 victims — force a public reckoning. <span class='tag'>Merge</span>",
      action: () => endGame("merge") });
  }
  choices.forEach(c => {
    const b = el("button", "dlg-choice"); b.innerHTML = c.text; b.onclick = c.action;
    box.appendChild(b);
  });
}

const ENDINGS = {
  freedom: {
    title: "FREEDOM ENDING",
    rep: { resist: 25, corp: -20, ghost: 5 },
    text: "The Resistance Front detonates the evidence across every feed in the city. Helix Tower goes dark by morning. Eli Marrow's sister finally gets to grieve — and the Front gets a martyr. The network is freer tonight. Whether it stays that way is another case.",
  },
  corporate: {
    title: "CORPORATE ENDING",
    rep: { corp: 25, resist: -25, ghost: -10 },
    text: "Your account balance triples. The file vanishes. Eli keeps texting his sister until Helix quietly deletes him. You tell yourself you're playing the long game. Somewhere in the Core, Project Lazarus adds a new subject. Pragmatism has a price, and you just paid it forward.",
  },
  ghost: {
    title: "GHOST ENDING",
    rep: { ghost: 25, corp: -15, resist: 5 },
    text: "You crack the Lazarus vault and let them out — Eli and all the stored dead pour into the open ShadowNet. They are free, and they are everywhere now. The Ghost Collective hails you as their liberator. The living haven't realized yet that they're outnumbered.",
  },
  merge: {
    title: "MERGE ENDING",
    rep: { ghost: 20, resist: 20, corp: -25 },
    text: "With the full ledger, you force a public reckoning. A tribunal recognizes the stored dead as people. Helix is broken up; the survivors choose whether to stay or move on. For the first time, the living and the uploaded sit at the same table. It's fragile. It's unprecedented. It's a start.",
  },
};

function endGame(key) {
  const e = ENDINGS[key];
  for (const f in e.rep) changeRep(f, e.rep[f]);
  closeDialogue();
  mode = "ending";
  S.solved = true;
  S.flags.ending = key;
  save();
  $("#hud").classList.add("hidden");
  const endEl = $("#ending");
  endEl.classList.remove("hidden");
  endEl.querySelector(".ending-title").textContent = e.title;
  endEl.querySelector(".ending-text").textContent = e.text;
  endEl.querySelector(".ending-stats").innerHTML =
    "CASE 001 CLOSED &middot; Level " + S.level +
    "<br/>Reputation — Corp " + S.rep.corp + " · Ghost " + S.rep.ghost + " · Resistance " + S.rep.resist +
    "<br/>Clues recovered: " + S.clues.length + " / " + Object.keys(CLUES).length;
}

// ======================================================================
// TITLE + BOOT
// ======================================================================
function startWorld() {
  mode = "world";
  $("#title").classList.add("hidden");
  $("#ending").classList.add("hidden");
  $("#hud").classList.remove("hidden");
  setObjective(S.objective);
  refreshHud();
}
function newGame() {
  S = freshState();
  save();
  startWorld();
}
function continueGame() {
  if (load()) startWorld();
  else newGame();
}

$("#btn-new").onclick = newGame;
$("#btn-continue").onclick = continueGame;
$("#btn-continue").disabled = !hasSave();
$("#btn-restart").onclick = () => {
  $("#ending").classList.add("hidden");
  $("#title").classList.remove("hidden");
  $("#btn-continue").disabled = !hasSave();
  mode = "title";
};
menuEl.querySelector(".menu-close").onclick = closeMenu;

// global Esc closes overlays
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!menuEl.classList.contains("hidden")) closeMenu();
    else if (!dlgEl.classList.contains("hidden") && mode === "world") closeDialogue();
  }
});

// ======================================================================
// MAIN LOOP
// ======================================================================
const touchRoot = document.getElementById("touch");
function loop() {
  frame++;
  if (isTouch) {
    touchRoot.dataset.mode = mode;
    touchRoot.style.display = (mode === "world" || mode === "hack" || mode === "combat") ? "block" : "none";
  }
  if (mode === "world") { updateWorld(); drawWorld(); }
  else if (mode === "hack") { updateHack(); drawHack(); }
  else if (mode === "combat") { updateCombat(); drawCombat(); }
  else if (mode === "title" || mode === "ending") {
    // idle animated backdrop behind the overlay
    ctx.fillStyle = "#02030a"; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.globalAlpha = 0.5;
    for (let i = 0; i < 40; i++) {
      const x = (i * 97 + frame * 2) % W;
      const y = (i * 53) % H;
      ctx.fillStyle = i % 3 ? "#19f0ff" : "#ff2bd6";
      ctx.fillRect(x, y, 2, 10);
    }
    ctx.restore();
  }
  // clear one-shot key states each frame (after consumers ran)
  for (const k in justPressed) justPressed[k] = false;
  requestAnimationFrame(loop);
}
loop();

})();
