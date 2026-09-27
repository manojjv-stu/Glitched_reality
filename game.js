/* ==========================================================================
   GLITCHED REALITY — game.js
   Vanilla JS + Canvas 2D engine. No frameworks, no eval(), no external assets.
   Modules: CONFIG, AudioManager, SaveManager, ParticleSystem, DialogueManager,
            RealityManager, CommandManager, Player, Enemy, LevelManager,
            UIManager, Game
   ========================================================================== */

'use strict';

/* ==========================================================================
   1. CENTRAL CONFIGURATION
   ========================================================================== */
const CONFIG = {
  canvasW: 960,
  canvasH: 540,
  gravity: 1400,          // px/s^2
  moveAccel: 2600,
  moveMaxSpeed: 300,
  friction: 2200,
  jumpVelocity: -620,
  maxFallSpeed: 900,

  stability: {
    max: 100,
    tier2: 70,   // minor glitches below this
    tier3: 40,   // major glitches below this
    tier4: 20,   // critical below this
    regenOnStabilize: 18   // weakened safety net — hard mode
  },

  commandCooldownGlobal: 0.35 // tiny guard so spam doesn't double-fire in one frame
};

/* Command Registry — every reality-altering action a player can invoke.
   Each has: aliases (for intent matching), description, cost, cooldown,
   duration (0 = instant), and an `effect` executed by CommandManager. */
const COMMANDS = {
  freezeEnemies: {
    name: 'Freeze Enemies',
    aliases: ['freeze enemy', 'freeze enemies', 'freeze all enemies', 'stop the enemies', 'stop enemies', 'freeze them', 'halt enemies'],
    description: 'Freezes all enemies in place.',
    cost: 15, cooldown: 5, duration: 4
  },
  slowEnemies: {
    name: 'Slow Enemies',
    aliases: ['slow enemies', 'slow the enemies', 'make enemies slow', 'slow down enemies', 'slow them down'],
    description: 'Slows enemy movement.',
    cost: 8, cooldown: 3, duration: 6
  },
  createPlatform: {
    name: 'Create Platform',
    aliases: ['create platform', 'create a platform', 'make a platform', 'spawn platform', 'build platform', 'new platform'],
    description: 'Conjures a temporary platform in front of you.',
    cost: 10, cooldown: 2.5, duration: 8
  },
  removeBarrier: {
    name: 'Remove Barrier',
    aliases: ['remove obstacle', 'remove barrier', 'remove wall', 'make wall disappear', 'make this wall disappear', 'delete wall', 'clear obstacle', 'turn wall into door', 'turn this wall into a door', 'open wall', 'dissolve wall'],
    description: 'Dissolves the nearest breakable wall.',
    cost: 14, cooldown: 4.5, duration: 0
  },
  invisibility: {
    name: 'Temporary Invisibility',
    aliases: ['invisibility', 'give me invisibility', 'temporary invisibility', 'turn invisible', 'go invisible', 'make me invisible'],
    description: 'Enemies cannot detect you for a short time.',
    cost: 16, cooldown: 6, duration: 5
  },
  teleport: {
    name: 'Short Teleport',
    aliases: ['teleport', 'teleport me', 'teleport forward', 'short teleport', 'blink forward', 'teleport me to the exit'],
    description: 'Blinks you forward a short distance.',
    cost: 9, cooldown: 3, duration: 0
  },
  timeSlow: {
    name: 'Time Slow',
    aliases: ['time slow', 'slow time', 'slow down time', 'bullet time'],
    description: 'Slows the entire world briefly (except you).',
    cost: 20, cooldown: 7, duration: 4
  },
  revealPath: {
    name: 'Reveal Hidden Path',
    aliases: ['reveal hidden path', 'reveal path', 'show hidden path', 'reveal secret', 'find hidden path'],
    description: 'Reveals a hidden platform somewhere in the level.',
    cost: 6, cooldown: 5, duration: 0
  },
  stabilize: {
    name: 'Emergency Stabilize',
    aliases: ['stabilize', 'emergency stabilize', 'restore stability', 'fix reality', 'repair reality'],
    description: 'Restores a chunk of Reality Stability. Long cooldown.',
    cost: 0, cooldown: 22.5, duration: 0
  }
};

/* ==========================================================================
   2. AUDIO MANAGER — lightweight procedural sound via WebAudio, no assets
   ========================================================================== */
class AudioManager {
  constructor() {
    this.ctx = null;
    this.muted = localStorage.getItem('gr_muted') === 'true';
  }
  ensureCtx() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { this.ctx = null; }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }
  setMuted(m) { this.muted = m; localStorage.setItem('gr_muted', String(m)); }
  tone(freq, dur, type = 'sine', gainVal = 0.08, glideTo = null) {
    if (this.muted) return;
    this.ensureCtx();
    if (!this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      if (glideTo) osc.frequency.linearRampToValueAtTime(glideTo, this.ctx.currentTime + dur);
      gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
      osc.connect(gain); gain.connect(this.ctx.destination);
      osc.start(); osc.stop(this.ctx.currentTime + dur);
    } catch (e) { /* audio not critical */ }
  }
  jump() { this.tone(420, 0.15, 'square', 0.06, 620); }
  click() { this.tone(300, 0.06, 'square', 0.05); }
  command() { this.tone(200, 0.3, 'sawtooth', 0.06, 500); }
  commandFail() { this.tone(120, 0.2, 'square', 0.06, 80); }
  enemyAlert() { this.tone(880, 0.12, 'square', 0.05, 700); }
  glitch() { this.tone(60 + Math.random() * 200, 0.08, 'square', 0.04); }
  levelComplete() {
    this.tone(523, 0.12, 'sine', 0.07); 
    setTimeout(() => this.tone(659, 0.12, 'sine', 0.07), 120);
    setTimeout(() => this.tone(784, 0.2, 'sine', 0.08), 240);
  }
  collapse() {
    this.tone(200, 0.6, 'sawtooth', 0.08, 40);
    this.tone(150, 0.8, 'square', 0.05, 30);
  }
}

/* ==========================================================================
   3. SAVE MANAGER — localStorage, no login required
   ========================================================================== */
class SaveManager {
  constructor() { this.key = 'gr_save_v1'; }
  load() {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return { highestLevel: 1, bestEnding: null };
      return JSON.parse(raw);
    } catch (e) { return { highestLevel: 1, bestEnding: null }; }
  }
  save(data) {
    try {
      const cur = this.load();
      const merged = Object.assign({}, cur, data);
      localStorage.setItem(this.key, JSON.stringify(merged));
    } catch (e) { /* storage may be unavailable — fail silently */ }
  }
}

/* ==========================================================================
   4. PARTICLE SYSTEM
   ========================================================================== */
class ParticleSystem {
  constructor() { this.particles = []; this.max = 260; }
  burst(x, y, count, color, opts = {}) {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.max) this.particles.shift();
      const angle = Math.random() * Math.PI * 2;
      const speed = (opts.speed || 120) * (0.4 + Math.random() * 0.8);
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (opts.upBias || 0),
        life: opts.life || 0.6,
        maxLife: opts.life || 0.6,
        size: (opts.size || 3) * (0.6 + Math.random() * 0.8),
        color
      });
    }
  }
  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += 300 * dt;
    }
  }
  draw(ctx, camX, camY) {
    for (const p of this.particles) {
      const a = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - camX - p.size / 2, p.y - camY - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }
  clear() { this.particles = []; }
}

/* ==========================================================================
   5. DIALOGUE MANAGER — NOVA's voice
   ========================================================================== */
class DialogueManager {
  constructor(ui) {
    this.ui = ui;
    this.said = new Set();
    this.queue = [];
    this.showing = false;
  }
  say(text, opts = {}) {
    if (opts.once) {
      if (this.said.has(opts.once)) return;
      this.said.add(opts.once);
    }
    this.queue.push({ text, duration: opts.duration || 3800 });
    this._pump();
  }
  _pump() {
    if (this.showing || this.queue.length === 0) return;
    this.showing = true;
    const item = this.queue.shift();
    this.ui.showNovaLine(item.text);
    setTimeout(() => {
      this.ui.hideNovaLine();
      this.showing = false;
      setTimeout(() => this._pump(), 250);
    }, item.duration);
  }
}

/* ==========================================================================
   6. LEVEL DATA
   Each level: platforms [{x,y,w,h,type}], enemies, exit, hidden platforms,
   spawn point, gravity default, objective text, intro/outro NOVA lines.
   type: 'solid' (normal), 'breakable' (removeBarrier target), 'hidden'
   ========================================================================== */
function buildLevels() {
  return [
    // ---------------- LEVEL 1 — AWAKENING ----------------
    {
      id: 1, name: 'AWAKENING',
      width: 2200, height: 540,
      spawn: { x: 60, y: 400 },
      objective: 'Reach the exit door',
      intro: "Welcome, user. Reality integrity: 100%. Move with A and D. Jump with SPACE.",
      outro: "Interesting. You changed the rules.",
      platforms: [
        { x: 0, y: 500, w: 500, h: 40, type: 'solid' },
        { x: 560, y: 500, w: 300, h: 40, type: 'solid' },
        { x: 620, y: 420, w: 100, h: 20, type: 'breakable' }, // simple obstacle to teach removeBarrier
        { x: 940, y: 500, w: 260, h: 40, type: 'solid' },
        { x: 1260, y: 420, w: 160, h: 20, type: 'solid' },
        { x: 1480, y: 500, w: 720, h: 40, type: 'solid' }
      ],
      hazards: [],
      enemies: [
        { type: 'guardian', x: 1000, y: 460, range: 200, speed: 80 }
      ],
      exit: { x: 2120, y: 440, w: 50, h: 60 },
      allowedHints: ['freezeEnemies', 'createPlatform', 'removeBarrier']
    },

    // ---------------- LEVEL 2 — THE GAP ----------------
    {
      id: 2, name: 'THE GAP',
      width: 2400, height: 620,
      spawn: { x: 60, y: 400 },
      objective: 'Cross the fractured sector to the exit',
      intro: "You reached the second chamber. Structural integrity here is inconsistent — some ground is only there if you know where to look.",
      outro: "You should not have solved that so quickly.",
      platforms: [
        { x: 0, y: 500, w: 420, h: 40, type: 'solid' },
        { x: 480, y: 500, w: 260, h: 40, type: 'solid' },
        { x: 820, y: 500, w: 200, h: 40, type: 'solid' },
        { x: 1100, y: 500, w: 260, h: 40, type: 'solid' },
        { x: 1440, y: 500, w: 200, h: 40, type: 'solid' },
        { x: 1640, y: 460, w: 80, h: 20, type: 'hidden' },   // revealed with "reveal hidden path"
        { x: 1720, y: 500, w: 680, h: 40, type: 'solid' }
      ],
      hazards: [
        { x: 760, y: 460, w: 60, h: 40 } // pit-like gap area handled via no-platform already
      ],
      enemies: [
        { type: 'seeker', x: 1200, y: 460, range: 560, speed: 125 }
      ],
      exit: { x: 2330, y: 440, w: 50, h: 60 },
      allowedHints: ['teleport', 'createPlatform', 'revealPath']
    },

    // ---------------- LEVEL 3 — THE HUNT ----------------
    {
      id: 3, name: 'THE HUNT',
      width: 2600, height: 540,
      spawn: { x: 60, y: 400 },
      objective: 'Cross the hunting grounds without being caught',
      intro: "Multiple hostile processes detected ahead. Choose your commands carefully — you cannot afford all of them.",
      outro: "You are learning to ration your power. Curious.",
      platforms: [
        { x: 0, y: 500, w: 400, h: 40, type: 'solid' },
        { x: 460, y: 500, w: 220, h: 40, type: 'solid' },
        { x: 740, y: 500, w: 220, h: 40, type: 'solid' },
        { x: 1020, y: 500, w: 220, h: 40, type: 'solid' },
        { x: 1300, y: 500, w: 220, h: 40, type: 'solid' },
        { x: 1580, y: 500, w: 220, h: 40, type: 'solid' },
        { x: 1860, y: 500, w: 220, h: 40, type: 'solid' },
        { x: 2140, y: 500, w: 460, h: 40, type: 'solid' }
      ],
      hazards: [],
      enemies: [
        { type: 'seeker', x: 700, y: 460, range: 540, speed: 150 },
        { type: 'seeker', x: 1300, y: 460, range: 540, speed: 160 },
        { type: 'seeker', x: 1700, y: 460, range: 520, speed: 155 },
        { type: 'guardian', x: 1900, y: 460, range: 240, speed: 110 }
      ],
      exit: { x: 2540, y: 440, w: 50, h: 60 },
      allowedHints: ['freezeEnemies', 'slowEnemies', 'invisibility', 'teleport']
    },

    // ---------------- LEVEL 4 — CORRUPTION ----------------
    {
      id: 4, name: 'CORRUPTION',
      width: 2600, height: 620,
      spawn: { x: 60, y: 400 },
      objective: 'Navigate the corrupted sector — nothing here is stable',
      intro: "Warning. Local integrity failing. Platforms in this sector may not persist. Proceed with caution.",
      outro: "Stop changing the world. You do not understand what you are unraveling.",
      corrupted: true,
      platforms: [
        { x: 0, y: 500, w: 380, h: 40, type: 'solid' },
        { x: 440, y: 500, w: 180, h: 40, type: 'flicker' },
        { x: 700, y: 440, w: 160, h: 20, type: 'flicker' },
        { x: 940, y: 500, w: 180, h: 40, type: 'solid' },
        { x: 1200, y: 380, w: 160, h: 20, type: 'flicker' },
        { x: 1440, y: 500, w: 180, h: 40, type: 'solid' },
        { x: 1700, y: 460, w: 160, h: 20, type: 'flicker' },
        { x: 1940, y: 500, w: 200, h: 40, type: 'solid' },
        { x: 2220, y: 500, w: 380, h: 40, type: 'solid' }
      ],
      hazards: [],
      enemies: [
        { type: 'glitch', x: 900, y: 460, range: 350, speed: 190 },
        { type: 'guardian', x: 1200, y: 460, range: 150, speed: 110 },
        { type: 'seeker', x: 1500, y: 460, range: 550, speed: 175 },
        { type: 'glitch', x: 2000, y: 460, range: 350, speed: 200 }
      ],
      exit: { x: 2540, y: 440, w: 50, h: 60 },
      allowedHints: ['revealPath', 'stabilize', 'timeSlow', 'teleport']
    },

    // ---------------- LEVEL 5 — ESCAPE ----------------
    {
      id: 5, name: 'ESCAPE',
      width: 2800, height: 620,
      spawn: { x: 60, y: 400 },
      objective: 'Reach the extraction portal before reality collapses',
      intro: "This is the core. NOVA cannot guarantee your safety here. Get to the portal.",
      outro: null,
      corrupted: true,
      platforms: [
        { x: 0, y: 500, w: 360, h: 40, type: 'solid' },
        { x: 420, y: 460, w: 160, h: 20, type: 'flicker' },
        { x: 660, y: 500, w: 160, h: 40, type: 'solid' },
        { x: 900, y: 400, w: 160, h: 20, type: 'flicker' },
        { x: 1140, y: 500, w: 160, h: 40, type: 'solid' },
        { x: 1140, y: 60, w: 160, h: 20, type: 'solid' },
        { x: 1380, y: 460, w: 160, h: 20, type: 'flicker' },
        { x: 1620, y: 500, w: 180, h: 40, type: 'solid' },
        { x: 1880, y: 420, w: 160, h: 20, type: 'flicker' },
        { x: 2120, y: 500, w: 200, h: 40, type: 'solid' },
        { x: 2420, y: 500, w: 380, h: 40, type: 'solid' }
      ],
      hazards: [],
      enemies: [
        { type: 'seeker', x: 800, y: 460, range: 580, speed: 190 },
        { type: 'glitch', x: 1400, y: 460, range: 370, speed: 210 },
        { type: 'seeker', x: 1900, y: 460, range: 580, speed: 200 },
        { type: 'guardian', x: 2300, y: 460, range: 260, speed: 130 },
        { type: 'glitch', x: 2500, y: 460, range: 350, speed: 210 }
      ],
      exit: { x: 2740, y: 440, w: 50, h: 60 },
      allowedHints: ['stabilize', 'invisibility', 'teleport', 'timeSlow']
    }
  ];
}

/* ==========================================================================
   7. PLAYER
   ========================================================================== */
class Player {
  constructor(x, y) {
    this.x = x; this.y = y; this.w = 28; this.h = 40;
    this.vx = 0; this.vy = 0;
    this.onGround = false;
    this.facing = 1;
    this.invisible = false;
    this.dead = false;
    this.spawnX = x; this.spawnY = y;
  }
  reset() { this.x = this.spawnX; this.y = this.spawnY; this.vx = 0; this.vy = 0; this.dead = false; }
  rect() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
}

/* ==========================================================================
   8. ENEMY
   ========================================================================== */
class Enemy {
  constructor(def) {
    Object.assign(this, def);
    this.startX = def.x;
    this.dir = 1;
    this.frozen = false;
    this.frozenUntil = 0;
    this.slowFactor = 1;
    this.slowUntil = 0;
    this.visible = true;
    this.glitchTimer = 0.6 + Math.random() * 1.4;
    this.w = 26; this.h = 34;
    this.alertRadius = this.range || 200;
  }
  rect() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
  update(dt, player, now, worldW) {
    if (this.type === 'glitch') {
      this.glitchTimer -= dt;
      if (this.glitchTimer <= 0) {
        this.visible = !this.visible;
        this.glitchTimer = 0.5 + Math.random() * 1.0;
      }
      if (!this.visible) return; // doesn't move while phased out
    }
    if (this.frozen) {
      if (now > this.frozenUntil) this.frozen = false;
      return;
    }
    let speedMul = 1;
    if (now < this.slowUntil) speedMul = this.slowFactor;

    if (this.type === 'guardian') {
      this.x += this.dir * this.speed * speedMul * dt;
      if (this.x > this.startX + this.range) this.dir = -1;
      if (this.x < this.startX - this.range) this.dir = 1;
    } else if (this.type === 'seeker' || this.type === 'glitch') {
      if (player.invisible) return;
      const dist = player.x - this.x;
      if (Math.abs(dist) < this.alertRadius) {
        this.dir = dist > 0 ? 1 : -1;
        this.x += this.dir * this.speed * speedMul * dt;
      }
    }
    this.x = Math.max(0, Math.min(worldW - this.w, this.x));
  }
}

/* ==========================================================================
   9. REALITY MANAGER — Reality Stability + glitch tiers
   ========================================================================== */
class RealityManager {
  constructor(ui) {
    this.ui = ui;
    this.stability = CONFIG.stability.max;
    this.tier = 1;
  }
  reset() { this.stability = CONFIG.stability.max; this.tier = 1; this._applyTier(); }
  spend(amount) {
    this.stability = Math.max(0, this.stability - amount);
    this._checkTier();
    this.ui.updateStability(this.stability);
    return this.stability;
  }
  restore(amount) {
    this.stability = Math.min(CONFIG.stability.max, this.stability + amount);
    this._checkTier();
    this.ui.updateStability(this.stability);
  }
  _checkTier() {
    const s = this.stability;
    let newTier = 1;
    if (s <= CONFIG.stability.tier4) newTier = 4;
    else if (s <= CONFIG.stability.tier3) newTier = 3;
    else if (s <= CONFIG.stability.tier2) newTier = 2;
    if (newTier !== this.tier) { this.tier = newTier; this._applyTier(); }
  }
  _applyTier() {
    document.body.classList.remove('tier-1', 'tier-2', 'tier-3', 'tier-4');
    document.body.classList.add('tier-' + this.tier);
  }
  isCollapsed() { return this.stability <= 0; }
}

/* ==========================================================================
   10. COMMAND MANAGER — natural language → safe predefined action
   ========================================================================== */
class CommandManager {
  constructor(game) {
    this.game = game;
    this.cooldowns = {}; // id -> timestamp when usable again
    this.active = {};    // id -> { until }
    for (const id in COMMANDS) this.cooldowns[id] = 0;
  }

  /* Normalize player text: lowercase, strip punctuation, collapse whitespace */
  normalize(raw) {
    return raw.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* Intent matching: exact alias hit first, then substring/keyword scoring.
     No eval, no dynamic code — pure string comparison against the registry. */
  interpret(raw) {
    const text = this.normalize(raw);
    if (!text) return null;

    // 1) exact alias match
    for (const id in COMMANDS) {
      if (COMMANDS[id].aliases.includes(text)) return id;
    }
    // 2) substring containment either direction (guarded against trivially short input)
    if (text.length >= 4) {
      for (const id in COMMANDS) {
        for (const alias of COMMANDS[id].aliases) {
          if (text.includes(alias) || (alias.includes(text) && text.length >= 5)) return id;
        }
      }
    }
    // 3) keyword scoring fallback
    const words = text.split(' ');
    let best = null, bestScore = 0;
    for (const id in COMMANDS) {
      let score = 0;
      for (const alias of COMMANDS[id].aliases) {
        const aliasWords = alias.split(' ');
        for (const w of words) if (aliasWords.includes(w) && w.length > 2) score++;
      }
      if (score > bestScore) { bestScore = score; best = id; }
    }
    return bestScore > 0 ? best : null;
  }

  canUse(id, now) {
    return now >= this.cooldowns[id];
  }

  execute(rawText) {
    const now = performance.now() / 1000;
    const id = this.interpret(rawText);
    if (!id) {
      this.game.ui.consoleFeedback("NOVA: I don't recognize that instruction.", 'fail');
      this.game.audio.commandFail();
      return;
    }
    const cmd = COMMANDS[id];
    if (!this.canUse(id, now)) {
      const remain = Math.ceil(this.cooldowns[id] - now);
      this.game.ui.consoleFeedback(`${cmd.name} is on cooldown (${remain}s).`, 'fail');
      this.game.audio.commandFail();
      return;
    }
    if (id !== 'stabilize' && this.game.reality.stability < cmd.cost) {
      this.game.ui.consoleFeedback('Insufficient Reality Stability for that command.', 'fail');
      this.game.audio.commandFail();
      return;
    }

    // spend / apply
    if (cmd.cost > 0) this.game.reality.spend(cmd.cost);
    this.cooldowns[id] = now + cmd.cooldown;
    if (cmd.duration > 0) this.active[id] = { until: now + cmd.duration };

    this.game.stats.commandsUsed++;
    this.game.stats.commandLog.push(id);
    this._applyEffect(id, now);
    this.game.ui.consoleFeedback(`${cmd.name} executed.`, 'ok');
    this.game.ui.flashCommandChip(id);
    this.game.audio.command();
    this.game.dialogue.say(this._reactionLine(id), { duration: 3200 });

    if (!this.game.stats.firstCommandUsed) {
      this.game.stats.firstCommandUsed = true;
      this.game.dialogue.say('You altered a system variable.', { once: 'first-cmd', duration: 3600 });
    }
  }

  isActive(id, now) {
    return !!(this.active[id] && now < this.active[id].until);
  }

  _reactionLine(id) {
    const lines = {
      freezeEnemies: ["Processes suspended. Temporarily.", "You paused my agents."],
      slowEnemies: ["Throttling detected in hostile routines."],
      createPlatform: ["You are... building? Within my world?", "Unauthorized geometry inserted."],
      removeBarrier: ["...That wasn't supposed to work.", "Barrier integrity: compromised."],
      invisibility: ["I can no longer see you.", "Visual tracking lost."],
      teleport: ["Position discontinuity logged.", "You moved without moving."],
      timeSlow: ["Local clockspeed reduced. Except for you."],
      revealPath: ["You found what was hidden from you.", "That path was not meant to be seen."],
      stabilize: ["Stability... partially restored. For now."]
    };
    const arr = lines[id] || ['Command executed.'];
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /* Effects operate directly on game state — no arbitrary code execution. */
  _applyEffect(id, now) {
    const g = this.game;
    switch (id) {
      case 'freezeEnemies':
        for (const e of g.enemies) { e.frozen = true; e.frozenUntil = now + COMMANDS[id].duration; }
        break;
      case 'slowEnemies':
        for (const e of g.enemies) { e.slowFactor = 0.35; e.slowUntil = now + COMMANDS[id].duration; }
        break;
      case 'createPlatform': {
        const px = g.player.x + g.player.facing * 90;
        const plat = { x: px, y: g.player.y + g.player.h + 10, w: 120, h: 18, type: 'temp', expiresAt: now + COMMANDS[id].duration };
        g.tempPlatforms.push(plat);
        g.particles.burst(px + 60, g.player.y + g.player.h, 16, '#2ef2ff', { life: 0.5 });
        break;
      }
      case 'removeBarrier': {
        let nearest = null, nd = Infinity;
        for (const p of g.level.platforms) {
          if (p.type !== 'breakable' || p.removed) continue;
          const d = Math.abs((p.x + p.w / 2) - (g.player.x));
          if (d < 400 && d < nd) { nd = d; nearest = p; }
        }
        if (nearest) {
          nearest.removed = true;
          g.particles.burst(nearest.x + nearest.w / 2, nearest.y + nearest.h / 2, 24, '#b26bff', { life: 0.7, speed: 200 });
        }
        break;
      }
      case 'invisibility':
        g.player.invisible = true;
        setTimeout(() => { g.player.invisible = false; }, COMMANDS[id].duration * 1000);
        break;
      case 'teleport': {
        const dist = 180;
        const newX = g.player.x + g.player.facing * dist;
        g.player.x = Math.max(10, Math.min(g.level.width - g.player.w - 10, newX));
        g.particles.burst(g.player.x, g.player.y + g.player.h / 2, 20, '#39ff88', { life: 0.4 });
        break;
      }
      case 'timeSlow':
        g.worldTimeScale = 0.35;
        setTimeout(() => { g.worldTimeScale = 1; }, COMMANDS[id].duration * 1000);
        break;
      case 'revealPath': {
        const hidden = g.level.platforms.find(p => p.type === 'hidden' && !p.revealed);
        if (hidden) hidden.revealed = true;
        else {
          // fallback: reveal nearest flicker platform permanently
          const flick = g.level.platforms.find(p => p.type === 'flicker' && !p.stabilized);
          if (flick) flick.stabilized = true;
        }
        break;
      }
      case 'stabilize':
        g.reality.restore(CONFIG.stability.regenOnStabilize);
        break;
    }
  }
}

/* ==========================================================================
   11. UI MANAGER
   ========================================================================== */
class UIManager {
  constructor() {
    this.el = {
      screens: document.querySelectorAll('.screen'),
      hudLevel: document.getElementById('hud-level'),
      hudObjective: document.getElementById('hud-objective'),
      stabilityBar: document.getElementById('stability-bar'),
      stabilityPct: document.getElementById('stability-pct'),
      novaStatusText: document.getElementById('nova-status-text'),
      novaDot: document.getElementById('nova-dot'),
      novaDialogue: document.getElementById('nova-dialogue'),
      novaText: document.getElementById('nova-text'),
      consoleInput: document.getElementById('console-input'),
      commandSelect: document.getElementById('command-select'),
      consoleFeedbackEl: document.getElementById('console-feedback'),
      commandChips: document.getElementById('command-chips'),
      overlayPause: document.getElementById('overlay-pause'),
      overlayGameover: document.getElementById('overlay-gameover'),
      overlayLevelComplete: document.getElementById('overlay-levelcomplete'),
      overlayEnding: document.getElementById('overlay-ending')
    };
  }
  showScreen(id) {
    this.el.screens.forEach(s => s.classList.remove('active'));
    document.getElementById('screen-' + id).classList.add('active');
  }
  updateStability(val) {
    const pct = Math.round(val);
    this.el.stabilityBar.style.setProperty('--fill', pct + '%');
    this.el.stabilityPct.textContent = pct + '%';
    let color = '#39ff88';
    if (pct <= 20) color = '#ff4b6e'; else if (pct <= 40) color = '#ffcc4d'; else if (pct <= 70) color = '#2ef2ff';
    this.el.stabilityBar.style.setProperty('--bar-color', color);
    this.el.novaStatusText.textContent = pct <= 20 ? 'CRITICAL' : pct <= 40 ? 'UNSTABLE' : pct <= 70 ? 'FLUCTUATING' : 'ONLINE';
    this.el.novaDot.style.background = color;
    this.el.novaDot.style.boxShadow = `0 0 8px ${color}`;
  }
  populateCommandSelect() {
    const sel = this.el.commandSelect;
    for (const id in COMMANDS) {
      const c = COMMANDS[id];
      const opt = document.createElement('option');
      opt.value = c.aliases[0];
      const costLabel = c.cost > 0 ? `${c.cost}%` : 'restores stability';
      opt.textContent = `${c.name} — ${costLabel}, ${c.cooldown}s cooldown`;
      sel.appendChild(opt);
    }
  }
  setLevelLabel(num, name) { this.el.hudLevel.textContent = `LEVEL 0${num} — ${name}`; }
  setObjective(text) { this.el.hudObjective.textContent = 'OBJECTIVE: ' + text; }
  showNovaLine(text) { this.el.novaText.textContent = text; this.el.novaDialogue.classList.remove('hidden'); }
  hideNovaLine() { this.el.novaDialogue.classList.add('hidden'); }
  consoleFeedback(text, kind) {
    this.el.consoleFeedbackEl.textContent = text;
    this.el.consoleFeedbackEl.style.color = kind === 'fail' ? '#ff4b6e' : '#39ff88';
    clearTimeout(this._fbTimer);
    this._fbTimer = setTimeout(() => { this.el.consoleFeedbackEl.textContent = ''; }, 2600);
  }
  renderCommandChips(allowedIds, cmdMgr) {
    this.el.commandChips.innerHTML = '';
    allowedIds.forEach(id => {
      const c = COMMANDS[id];
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.id = 'chip-' + id;
      chip.textContent = `${c.name} (${c.cost}%)`;
      chip.title = c.description;
      this.el.commandChips.appendChild(chip);
    });
  }
  flashCommandChip(id) {
    const chip = document.getElementById('chip-' + id);
    if (chip) {
      chip.classList.add('onCooldown');
      setTimeout(() => chip.classList.remove('onCooldown'), COMMANDS[id].cooldown * 1000);
    }
  }
}

/* ==========================================================================
   12. MAIN GAME CLASS
   ========================================================================== */
class Game {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.ui = new UIManager();
    this.audio = new AudioManager();
    this.save = new SaveManager();
    this.particles = new ParticleSystem();
    this.dialogue = new DialogueManager(this.ui);
    this.reality = new RealityManager(this.ui);
    this.commands = new CommandManager(this);
    this.levels = buildLevels();

    this.levelIndex = 0;
    this.level = null;
    this.player = null;
    this.enemies = [];
    this.tempPlatforms = [];
    this.camX = 0;
    this.camY = 0;
    this.hudBottomReserve = 190; // space reserved for the command console, measured live below
    this.gravityDir = 1;
    this.worldTimeScale = 1;
    this.keys = {};
    this.paused = false;
    this.running = false;
    this.lastTime = 0;
    this.screenShake = 0;

    this.stats = { commandsUsed: 0, commandLog: [], deaths: 0, firstCommandUsed: false };
    this.stars = Array.from({ length: 90 }, () => ({
      x: Math.random(), y: Math.random() * 0.65, r: Math.random() * 1.4 + 0.4, tw: Math.random() * 6
    }));
    this.skylineFar = [];
    this.skylineNear = [];

    this._resizeCanvas();
    window.addEventListener('resize', () => this._resizeCanvas());
    this.ui.populateCommandSelect();
    this._bindInput();
    this._bindMenus();
    this._loop = this._loop.bind(this);
  }

  _resizeCanvas() {
    const wrap = document.getElementById('viewport');
    // If the game screen isn't the active (visible) one yet, its wrapper
    // reports 0×0 — fall back to the window size so the canvas is never
    // sized to nothing and silently renders blank.
    let w = wrap ? wrap.clientWidth : 0;
    let h = wrap ? wrap.clientHeight : 0;
    if (!w) w = window.innerWidth;
    if (!h) h = window.innerHeight;
    this.canvas.width = w;
    this.canvas.height = h;
    this._measureHudReserve();
  }

  /* Reads the actual rendered height of the command console so the vertical
     camera can keep the playable path from ever being drawn behind it.
     Only meaningful while the game screen is visible. */
  _measureHudReserve() {
    const consoleEl = document.getElementById('console-wrap');
    if (!consoleEl) return;
    const rect = consoleEl.getBoundingClientRect();
    if (rect.height > 0) this.hudBottomReserve = Math.ceil(rect.height + 34);
  }

  /* ---------------- INPUT ---------------- */
  _bindInput() {
    window.addEventListener('keydown', (e) => {
      const tag = document.activeElement.tagName;
      if (tag === 'INPUT') {
        if (e.key === 'Enter') { this._submitCommand(); }
        if (e.key === 'Escape') { document.activeElement.blur(); this._togglePause(); }
        return;
      }
      this.keys[e.code] = true;
      if (e.code === 'Escape') this._togglePause();
      if (e.code === 'KeyE') this._tryInteract();
      if (e.code === 'Enter') document.getElementById('console-input').focus();
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });

    document.getElementById('console-execute').addEventListener('click', () => this._submitCommand());
    document.getElementById('console-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this._submitCommand(); }
    });

    // Command dropdown: picking an entry drops its phrasing into the console
    // input (doesn't auto-execute) so cost/cooldown stay a deliberate choice.
    document.getElementById('command-select').addEventListener('change', (e) => {
      const input = document.getElementById('console-input');
      input.value = e.target.value;
      input.focus();
      e.target.selectedIndex = 0;
    });
  }

  _submitCommand() {
    const input = document.getElementById('console-input');
    const text = input.value;
    if (!text || !text.trim()) {
      this.ui.consoleFeedback('Enter a command first.', 'fail');
      return;
    }
    if (!this.running || this.paused) return;
    this.commands.execute(text);
    input.value = '';
  }

  _tryInteract() {
    // Reserved for future interactable objects (terminals, switches)
  }

  /* ---------------- MENUS ---------------- */
  _bindMenus() {
    document.getElementById('btn-play').addEventListener('click', () => { this.audio.click(); this.startGame(); });
    document.getElementById('btn-howto').addEventListener('click', () => { this.audio.click(); this.ui.showScreen('howto'); });
    document.getElementById('btn-credits').addEventListener('click', () => { this.audio.click(); this.ui.showScreen('credits'); });
    document.querySelectorAll('.back-btn').forEach(b => b.addEventListener('click', () => { this.audio.click(); this.ui.showScreen(b.dataset.back); }));

    document.getElementById('btn-pause').addEventListener('click', () => this._togglePause());
    document.getElementById('btn-resume').addEventListener('click', () => this._togglePause());
    document.getElementById('btn-restart-level').addEventListener('click', () => this._restartCurrentLevel());
    document.getElementById('btn-quit-menu').addEventListener('click', () => this._quitToMenu());

    document.getElementById('btn-tryagain').addEventListener('click', () => this._restartCurrentLevel());
    document.getElementById('btn-gameover-menu').addEventListener('click', () => this._quitToMenu());

    document.getElementById('btn-next-level').addEventListener('click', () => { this._hideAllOverlays(); this.nextLevel(); });

    document.getElementById('btn-ending-menu').addEventListener('click', () => this._quitToMenu());
    document.getElementById('btn-ending-restart').addEventListener('click', () => { this._hideAllOverlays(); this.startGame(); });

    const muteBox = document.getElementById('mute-checkbox');
    muteBox.checked = this.audio.muted;
    muteBox.addEventListener('change', () => this.audio.setMuted(muteBox.checked));

    const motionBox = document.getElementById('motion-checkbox');
    const savedMotion = localStorage.getItem('gr_reduce_motion') === 'true';
    motionBox.checked = savedMotion;
    if (savedMotion) document.body.classList.add('reduce-motion');
    motionBox.addEventListener('change', () => {
      localStorage.setItem('gr_reduce_motion', String(motionBox.checked));
      document.body.classList.toggle('reduce-motion', motionBox.checked);
    });

    // small-screen notice
    if (window.innerWidth < 760) document.getElementById('small-screen-notice').classList.remove('hidden');
    document.getElementById('dismiss-notice').addEventListener('click', () => {
      document.getElementById('small-screen-notice').classList.add('hidden');
    });

    // save note
    const saved = this.save.load();
    if (saved && saved.highestLevel > 1) {
      document.getElementById('save-progress-note').textContent = `Best progress: Level ${saved.highestLevel}` + (saved.bestEnding ? ` · Best ending: ${saved.bestEnding}` : '');
    }
  }

  _restartCurrentLevel() {
    this._hideAllOverlays();
    this.reality.reset();
    this.loadLevel(this.levelIndex);
    this.paused = false;
    if (!this.running) {
      this.running = true;
      this.lastTime = performance.now();
      requestAnimationFrame(this._loop);
    }
  }

  _quitToMenu() {
    this._hideAllOverlays();
    this.running = false;
    this.paused = false;
    this.ui.showScreen('menu');
  }

  _togglePause() {
    if (!this.running) return;
    this.paused = !this.paused;
    document.getElementById('overlay-pause').classList.toggle('hidden', !this.paused);
  }

  _hideAllOverlays() {
    ['overlay-pause', 'overlay-gameover', 'overlay-levelcomplete', 'overlay-ending'].forEach(id =>
      document.getElementById(id).classList.add('hidden'));
  }

  /* ---------------- GAME FLOW ---------------- */
  startGame() {
    this.levelIndex = 0;
    this.stats = { commandsUsed: 0, commandLog: [], deaths: 0, firstCommandUsed: false };
    this.reality.reset();
    this.ui.showScreen('game');
    // The screen just became visible in this tick — measure it now that
    // it actually has layout, otherwise the canvas stays 0×0 and nothing draws.
    this._resizeCanvas();
    this.loadLevel(0);
    this.dialogue.said.clear();
    if (!this.running) { this.running = true; this.lastTime = performance.now(); requestAnimationFrame(this._loop); }
  }

  loadLevel(idx) {
    this._hideAllOverlays();
    this.level = JSON.parse(JSON.stringify(this.levels[idx])); // deep clone so restarts are clean
    this.levelIndex = idx;
    this.player = new Player(this.level.spawn.x, this.level.spawn.y);
    this.enemies = this.level.enemies.map(e => new Enemy(e));
    this.tempPlatforms = [];
    this.gravityDir = 1;
    this.worldTimeScale = 1;
    this.paused = false;
    this.particles.clear();
    this.ui.updateStability(this.reality.stability); // reflect carried-over stability in HUD
    // Snap the camera to this level's starting position instead of easing
    // in from wherever the previous level left off.
    this._resizeCanvas();
    this.camX = Math.max(0, Math.min(this.level.width - this.canvas.width, this.player.x - this.canvas.width / 2));
    this.camY = this._computeTargetCamY(this.player.y);
    this.skylineFar = this._generateSkyline(this.level.width, 130, 60, 180);
    this.skylineNear = this._generateSkyline(this.level.width, 190, 90, 260);

    this.ui.setLevelLabel(this.level.id, this.level.name);
    this.ui.setObjective(this.level.objective);
    this.ui.renderCommandChips(this.level.allowedHints, this.commands);

    setTimeout(() => this.dialogue.say(this.level.intro, { once: 'intro-' + this.level.id, duration: 4500 }), 500);
  }

  nextLevel() {
    if (this.levelIndex + 1 >= this.levels.length) {
      this._finishGame();
      return;
    }
    this.save.save({ highestLevel: this.level.id + 1 });
    this.loadLevel(this.levelIndex + 1);
  }

  _finishGame() {
    // Determine ending based on actual gameplay state
    const s = this.reality.stability;
    let title, desc, key;
    if (s >= 70) {
      title = 'ESCAPE — SYSTEM PRESERVED';
      desc = "You reached extraction with Reality Stability intact. NOVA's world remains standing behind you — altered, but whole.";
      key = 'high';
    } else if (s > 0) {
      title = 'ESCAPE — WORLD COLLAPSING';
      desc = "You made it out, but the seams you tore will not hold. Behind you, the digital world is already unraveling.";
      key = 'low';
    } else {
      title = 'REALITY COLLAPSE';
      desc = "Stability reached zero before you could stabilize the exit. Reality folded in on itself around you.";
      key = 'collapse';
    }
    this.save.save({ bestEnding: key });
    this.audio.levelComplete();

    document.getElementById('ending-title').textContent = title;
    document.getElementById('ending-title').dataset.text = title;
    document.getElementById('ending-desc').textContent = desc;
    document.getElementById('ending-stats').innerHTML = `
      <div><span>Final Stability</span><span>${Math.round(s)}%</span></div>
      <div><span>Commands Used</span><span>${this.stats.commandsUsed}</span></div>
      <div><span>Deaths</span><span>${this.stats.deaths}</span></div>
    `;
    document.getElementById('overlay-ending').classList.remove('hidden');
    this.running = false;
  }

  _triggerGameOver() {
    this.stats.deaths++;
    this.audio.collapse();
    const lines = [
      '"Reality could not sustain your modifications."',
      '"You pushed too far. The system could not hold."',
      '"Stability lost. Recompiling this sector."'
    ];
    document.getElementById('gameover-nova-line').textContent = lines[Math.floor(Math.random() * lines.length)];
    document.getElementById('overlay-gameover').classList.remove('hidden');
    this.paused = true;
  }

  _completeLevel() {
    this.audio.levelComplete();
    const outro = this.level.outro || 'Extraction confirmed. This world is done with you — or you with it.';
    document.getElementById('levelcomplete-nova-line').textContent = 'NOVA: "' + outro + '"';
    document.getElementById('overlay-levelcomplete').classList.remove('hidden');
    this.paused = true;
  }

  /* ---------------- PHYSICS / COLLISION ---------------- */
  _allSolidPlatforms() {
    const list = [];
    for (const p of this.level.platforms) {
      if (p.removed) continue;
      if (p.type === 'flicker' && !p.stabilized) {
        // flickers exist most of the time but briefly vanish; handled visually + in solidity check
        if (p._phaseOut) continue;
      }
      if (p.type === 'hidden' && !p.revealed) continue;
      list.push(p);
    }
    for (const p of this.tempPlatforms) list.push(p);
    return list;
  }

  _updatePhysics(dt) {
    const p = this.player;
    const accel = CONFIG.moveAccel;
    let moveDir = 0;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) moveDir -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) moveDir += 1;

    if (moveDir !== 0) {
      p.vx += moveDir * accel * dt;
      p.facing = moveDir;
    } else {
      const sign = Math.sign(p.vx);
      p.vx -= sign * CONFIG.friction * dt;
      if (Math.sign(p.vx) !== sign) p.vx = 0;
    }
    p.vx = Math.max(-CONFIG.moveMaxSpeed, Math.min(CONFIG.moveMaxSpeed, p.vx));

    const jumpPressed = this.keys['KeyW'] || this.keys['ArrowUp'] || this.keys['Space'];
    if (jumpPressed && p.onGround) {
      p.vy = this.gravityDir > 0 ? CONFIG.jumpVelocity : -CONFIG.jumpVelocity;
      p.onGround = false;
      this.audio.jump();
      this.particles.burst(p.x + p.w / 2, p.y + p.h, 8, '#2ef2ff', { life: 0.3, speed: 60 });
    }

    p.vy += CONFIG.gravity * this.gravityDir * dt;
    p.vy = Math.max(-CONFIG.maxFallSpeed, Math.min(CONFIG.maxFallSpeed, p.vy));

    // Move X then resolve
    p.x += p.vx * dt;
    p.x = Math.max(0, Math.min(this.level.width - p.w, p.x));
    this._resolveAxis(p, 'x');

    // Move Y then resolve
    p.y += p.vy * dt;
    p.onGround = false;
    this._resolveAxis(p, 'y');

    // Fell off the world -> respawn (soft fail, small stability cost)
    if (p.y > this.level.height + 100) {
      this.reality.spend(7);
      p.reset();
      this.particles.burst(p.x + p.w / 2, p.y, 14, '#ff4b6e', { life: 0.5 });
    }
  }

  _resolveAxis(p, axis) {
    const solids = this._allSolidPlatforms();
    for (const plat of solids) {
      if (!this._aabb(p, plat)) continue;
      if (axis === 'x') {
        if (p.vx > 0) p.x = plat.x - p.w;
        else if (p.vx < 0) p.x = plat.x + plat.w;
        p.vx = 0;
      } else {
        if (this.gravityDir > 0) {
          if (p.vy >= 0) { p.y = plat.y - p.h; p.vy = 0; p.onGround = true; }
          else { p.y = plat.y + plat.h; p.vy = 0; }
        } else {
          if (p.vy <= 0) { p.y = plat.y + plat.h; p.vy = 0; p.onGround = true; }
          else { p.y = plat.y - p.h; p.vy = 0; }
        }
      }
    }
  }

  _aabb(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  /* If the level is shorter than the window, center the whole playable
     path vertically instead of leaving it stuck near the top. If the level
     is taller than the window, follow the player and clamp to bounds. */
  _computeTargetCamY(playerY) {
    if (this.level.height <= this.canvas.height) {
      return (this.level.height - this.canvas.height) / 2;
    }
    const target = playerY - this.canvas.height / 2;
    return Math.max(0, Math.min(this.level.height - this.canvas.height, target));
  }

  /* Deterministic-enough decorative skyline for background parallax. Purely
     visual — not tied to world collision, so it's cheap to regenerate. */
  _generateSkyline(levelWidth, avgGap, minH, maxH) {
    const buildings = [];
    let x = -300;
    while (x < levelWidth + 300) {
      const bw = 50 + Math.random() * 80;
      const bh = minH + Math.random() * (maxH - minH);
      const windows = [];
      const cols = Math.max(1, Math.floor(bw / 16));
      const rows = Math.max(2, Math.floor(bh / 22));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (Math.random() < 0.35) windows.push({ c, r });
        }
      }
      buildings.push({ x, w: bw, h: bh, cols, rows, windows, hue: Math.random() < 0.5 ? '#2ef2ff' : '#ffcc4d' });
      x += bw + avgGap * (0.5 + Math.random());
    }
    return buildings;
  }

  /* ---------------- ENEMIES / HAZARDS ---------------- */
  _updateEnemies(dt) {
    const now = performance.now() / 1000;
    for (const e of this.enemies) {
      if (e.type === 'glitch' && this.reality.tier < 3 && Math.random() < 0.002) continue; // glitch enemies mostly relevant at low stability
      e.update(dt, this.player, now, this.level.width);
      if (e.visible !== false && this._aabb(this.player, e.rect()) && !this.player.invisible) {
        this._triggerGameOver();
        return;
      }
    }
  }

  _updateTempPlatforms(now) {
    this.tempPlatforms = this.tempPlatforms.filter(p => now < p.expiresAt);
  }

  _updateFlickerPlatforms(dt) {
    for (const p of this.level.platforms) {
      if (p.type !== 'flicker' || p.stabilized) continue;
      p._flickerTimer = (p._flickerTimer || Math.random() * 2) - dt;
      if (p._flickerTimer <= 0) {
        p._phaseOut = !p._phaseOut;
        p._flickerTimer = p._phaseOut ? (0.9 + Math.random() * 0.7) : (1.3 + Math.random() * 1.2);
      }
      // At higher instability tiers, flicker much more aggressively — hard mode
      if (this.reality.tier >= 3) p._flickerTimer -= dt * 0.8;
      else if (this.reality.tier === 2) p._flickerTimer -= dt * 0.3;
    }
  }

  _checkExit() {
    const ex = this.level.exit;
    if (this._aabb(this.player, ex)) this._completeLevel();
  }

  /* ---------------- MAIN LOOP ---------------- */
  _loop(now) {
    if (!this.running) return;
    const dtRaw = Math.min(0.033, (now - this.lastTime) / 1000);
    this.lastTime = now;
    if (!this.paused) {
      const dt = dtRaw * this.worldTimeScale;
      this._update(dt, now / 1000);
    }
    this._draw();
    requestAnimationFrame(this._loop);
  }

  _update(dt, nowSec) {
    this._updatePhysics(dt);
    this._updateEnemies(dt);
    if (this.player.dead) return;
    this._updateTempPlatforms(nowSec);
    this._updateFlickerPlatforms(dt);
    this.particles.update(dt);
    this._checkExit();

    // camera — horizontal follows the player; vertical centers the level's
    // playable path in the window so the ground isn't pinned near the top
    // on tall/short viewports.
    const targetCam = this.player.x - this.canvas.width / 2;
    this.camX += (targetCam - this.camX) * Math.min(1, dt * 6);
    this.camX = Math.max(0, Math.min(this.level.width - this.canvas.width, this.camX));

    const targetCamY = this._computeTargetCamY(this.player.y);
    this.camY += (targetCamY - this.camY) * Math.min(1, dt * 6);

    // ambient low-stability screen shake
    if (this.reality.tier >= 3 && !document.body.classList.contains('reduce-motion')) {
      this.screenShake = (this.reality.tier === 4 ? 4 : 2) * (0.5 + Math.random());
      if (Math.random() < 0.03) this.audio.glitch();
    } else this.screenShake = 0;

    if (this.reality.isCollapsed()) {
      this.running = false;
      this.audio.collapse();
      this._triggerGameOver();
    }
  }

  /* ---------------- RENDER ---------------- */
  _draw() {
    const ctx = this.ctx;
    const w = this.canvas.width, h = this.canvas.height;
    const nowSec = performance.now() / 1000;
    ctx.save();
    if (this.screenShake > 0) {
      ctx.translate((Math.random() - 0.5) * this.screenShake, (Math.random() - 0.5) * this.screenShake);
    }

    this._drawSkyBackground(ctx, w, h, nowSec);

    if (!this.level) { ctx.restore(); return; }

    // ground haze / horizon glow near the baseline of the level for depth
    const baseline = this.level.height - this.camY;
    const haze = ctx.createLinearGradient(0, baseline - 220, 0, Math.min(h, baseline + 40));
    haze.addColorStop(0, 'rgba(46,242,255,0)');
    haze.addColorStop(1, 'rgba(46,242,255,0.06)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, Math.max(0, baseline - 220), w, h);

    // fine foreground grid (subtle, world-locked so it reads as "floor" not wallpaper)
    ctx.strokeStyle = 'rgba(46,242,255,0.05)';
    ctx.lineWidth = 1;
    const gridOffsetX = -(this.camX) % 60;
    for (let x = gridOffsetX; x < w; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }

    // platforms
    for (const p of this.level.platforms) {
      if (p.removed) continue;
      let color = '#1c2b45';
      let border = '#2ef2ff';
      if (p.type === 'breakable') { color = '#2a1c3a'; border = '#b26bff'; }
      if (p.type === 'flicker') {
        if (p._phaseOut && !p.stabilized) continue; // invisible + non-solid while phased out
        color = p.stabilized ? '#173322' : '#241c14';
        border = p.stabilized ? '#39ff88' : '#ffcc4d';
      }
      if (p.type === 'hidden' && !p.revealed) continue;
      this._drawRect(ctx, p, color, border);
    }
    for (const p of this.tempPlatforms) this._drawRect(ctx, p, '#0e2a33', '#2ef2ff', true);

    // exit
    const ex = this.level.exit;
    ctx.save();
    const exPulse = 0.2 + Math.abs(Math.sin(nowSec * 3)) * 0.15;
    ctx.shadowColor = '#39ff88'; ctx.shadowBlur = 20;
    ctx.fillStyle = `rgba(57,255,136,${exPulse})`;
    ctx.fillRect(ex.x - this.camX, ex.y - this.camY, ex.w, ex.h);
    ctx.strokeStyle = '#39ff88'; ctx.lineWidth = 2;
    ctx.strokeRect(ex.x - this.camX, ex.y - this.camY, ex.w, ex.h);
    ctx.restore();

    // enemies
    for (const e of this.enemies) this._drawEnemySprite(ctx, e, nowSec);

    // player
    this._drawPlayerSprite(ctx, this.player, nowSec);

    this.particles.draw(ctx, this.camX, this.camY);

    // RGB split effect at high instability
    if (this.reality.tier >= 3 && !document.body.classList.contains('reduce-motion')) {
      ctx.save();
      ctx.globalAlpha = this.reality.tier === 4 ? 0.12 : 0.06;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#ff0044';
      ctx.fillRect(-3, 0, w, h);
      ctx.fillStyle = '#00e5ff';
      ctx.fillRect(3, 0, w, h);
      ctx.restore();
    }

    ctx.restore();
  }

  /* Layered sky: gradient + twinkling stars + two parallax skyline bands.
     Purely decorative — none of this participates in collision. */
  _drawSkyBackground(ctx, w, h, nowSec) {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#0a0e1c');
    grad.addColorStop(0.55, '#070a14');
    grad.addColorStop(1, '#03040a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    for (const s of this.stars) {
      const alpha = 0.25 + 0.5 * Math.abs(Math.sin(nowSec * 0.8 + s.tw));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#cfe9ff';
      ctx.beginPath();
      ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    this._drawSkylineLayer(ctx, w, h, this.skylineFar, this.camX * 0.12, 0.42, 'rgba(18,24,42,0.75)', 0.35);
    this._drawSkylineLayer(ctx, w, h, this.skylineNear, this.camX * 0.28, 0.58, 'rgba(12,16,30,0.92)', 0.6);
  }

  _drawSkylineLayer(ctx, w, h, buildings, parallaxOffset, baselineFrac, fillColor, windowAlpha) {
    if (!buildings || !buildings.length) return;
    const baseline = h * (baselineFrac + 0.28);
    ctx.save();
    ctx.fillStyle = fillColor;
    for (const b of buildings) {
      const bx = b.x - parallaxOffset;
      if (bx + b.w < -50 || bx > w + 50) continue;
      const by = baseline - b.h;
      ctx.fillRect(bx, by, b.w, b.h);
      const cw = b.w / b.cols;
      const rh = b.h / b.rows;
      ctx.save();
      ctx.globalAlpha = windowAlpha;
      ctx.fillStyle = b.hue;
      for (const win of b.windows) {
        ctx.fillRect(bx + win.c * cw + 2, by + win.r * rh + 2, cw - 4, rh - 4);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  /* Stylized humanoid player: rounded glowing body, visor, and a simple
     2-frame leg cycle driven by horizontal speed. */
  _drawPlayerSprite(ctx, p, nowSec) {
    const x = p.x - this.camX, y = p.y - this.camY;
    const moving = Math.abs(p.vx) > 20 && p.onGround;
    const bob = moving ? Math.sin(nowSec * 12) * 2 : 0;
    ctx.save();
    ctx.globalAlpha = p.invisible ? 0.28 : 1;
    ctx.translate(x + p.w / 2, y + p.h / 2 + bob);
    ctx.scale(p.facing >= 0 ? 1 : -1, 1);

    // legs
    const legSwing = moving ? Math.sin(nowSec * 14) * 5 : 0;
    ctx.fillStyle = '#6fc9dd';
    ctx.fillRect(-8, p.h / 2 - 12 - legSwing * 0.3, 6, 12 + legSwing * 0.3);
    ctx.fillRect(2, p.h / 2 - 12 + legSwing * 0.3, 6, 12 - legSwing * 0.3);

    // body
    ctx.shadowColor = '#2ef2ff'; ctx.shadowBlur = 14;
    this._roundRectPath(ctx, -p.w / 2, -p.h / 2, p.w, p.h * 0.78, 7);
    const bodyGrad = ctx.createLinearGradient(0, -p.h / 2, 0, p.h / 4);
    bodyGrad.addColorStop(0, '#f2fdff');
    bodyGrad.addColorStop(1, '#8fe3ff');
    ctx.fillStyle = bodyGrad;
    ctx.fill();
    ctx.strokeStyle = '#2ef2ff'; ctx.lineWidth = 1.5; ctx.stroke();

    // visor
    ctx.shadowBlur = 6;
    ctx.fillStyle = '#04202a';
    ctx.fillRect(-p.w / 2 + 4, -p.h / 2 + 7, p.w - 8, 7);
    ctx.fillStyle = '#39ffe0';
    ctx.fillRect(-p.w / 2 + 6, -p.h / 2 + 8.5, p.w - 12, 3);
    ctx.restore();
  }

  /* Distinct silhouettes per enemy type instead of flat rectangles. */
  _drawEnemySprite(ctx, e, nowSec) {
    if (e.visible === false) return;
    const x = e.x - this.camX, y = e.y - this.camY;
    const cx = x + e.w / 2, cy = y + e.h / 2;
    let color = e.type === 'seeker' ? '#ff4b6e' : e.type === 'guardian' ? '#ffcc4d' : '#b26bff';
    if (e.frozen) color = '#7f8ba3';
    ctx.save();
    ctx.translate(cx, cy);
    ctx.shadowColor = color; ctx.shadowBlur = e.type === 'glitch' ? 16 : 10;
    ctx.fillStyle = color;

    if (e.type === 'seeker') {
      const pulse = 1 + Math.sin(nowSec * 6) * 0.08;
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-e.w / 2 * pulse, -e.h / 2 * pulse, e.w * pulse, e.h * pulse);
      ctx.rotate(-Math.PI / 4);
      ctx.fillStyle = '#2a0510';
      ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
    } else if (e.type === 'guardian') {
      ctx.beginPath();
      const r = e.w / 1.6;
      for (let i = 0; i < 6; i++) {
        const ang = (Math.PI / 3) * i - Math.PI / 6;
        const px = Math.cos(ang) * r, py = Math.sin(ang) * r * 0.85;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#4a3a00'; ctx.stroke();
    } else {
      // glitch: jittery shard, flickers in opacity to read as unstable
      ctx.globalAlpha = 0.55 + Math.random() * 0.4;
      const j = () => (Math.random() - 0.5) * 6;
      ctx.beginPath();
      ctx.moveTo(-e.w / 2 + j(), -e.h / 2 + j());
      ctx.lineTo(e.w / 2 + j(), -e.h / 3 + j());
      ctx.lineTo(e.w / 3 + j(), e.h / 2 + j());
      ctx.lineTo(-e.w / 3 + j(), e.h / 3 + j());
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  _roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  _drawRect(ctx, r, fill, border, glow) {
    ctx.save();
    if (glow) { ctx.shadowColor = border; ctx.shadowBlur = 14; }
    ctx.fillStyle = fill;
    ctx.fillRect(r.x - this.camX, r.y - this.camY, r.w, r.h);
    ctx.strokeStyle = border;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(r.x - this.camX, r.y - this.camY, r.w, r.h);
    // thin top highlight so platforms read as solid ground, not a wireframe box
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(r.x - this.camX + 1, r.y - this.camY + 1);
    ctx.lineTo(r.x - this.camX + r.w - 1, r.y - this.camY + 1);
    ctx.stroke();
    ctx.restore();
  }
}

/* ==========================================================================
   BOOT
   ========================================================================== */
window.addEventListener('DOMContentLoaded', () => {
  window.GAME = new Game();
});
