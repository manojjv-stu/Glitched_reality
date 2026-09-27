# GLITCHED REALITY

> **Don't play by the rules. Rewrite them.**

A browser-based puzzle/survival platformer where you escape a digital world by typing natural-language commands that rewrite its rules — at the cost of the world's own stability.

---

## Overview

GLITCHED REALITY is a 2D platformer built entirely in vanilla HTML5, CSS3, and JavaScript (Canvas API), with no external game engine, no build step, and no server. You play a user trapped inside a system controlled by an AI, **NOVA**. Movement and platforming are standard — but when a wall blocks your path, an enemy hunts you, or a gap can't be crossed, you don't look for a lever. You type what you want to happen.

## Game Concept

Five levels take you from a simple locked room to the collapsing core of NOVA's system. Each level is built around a different combination of movement, enemies, and reality-manipulation commands, and NOVA's dialogue shifts from curious, to suspicious, to openly hostile as you keep rewriting her world.

## Innovation

The central innovation is that **natural language is the primary gameplay verb**, not a chat sidebar bolted onto a platformer. Typing "reverse gravity" or "turn this wall into a door" doesn't trigger a canned animation — it changes real, simulated game state (gravity direction, collision geometry, enemy AI) that the rest of the level reacts to. The tension the game is built around is entirely emergent: *what can I change, and is it worth what it costs?*

## Gameplay

- Run, jump, and navigate hazards and enemies across five hand-built levels.
- Open the NOVA Command Console and type a command in plain English.
- The command is interpreted locally (no external calls) into one of ten predefined, safe game actions.
- Every command consumes **Reality Stability**. As it drops, the world visually and mechanically destabilizes.
- Reach each level's exit to progress. Reach the final extraction portal to end the game — your ending is determined by your final Stability, not chosen manually.

## Core Mechanics

| System | Description |
|---|---|
| Movement | Custom lightweight 2D physics: acceleration, friction, gravity, jump arcs, AABB collision |
| Command Console | Natural-language input mapped to a fixed command registry via alias + keyword matching |
| Reality Stability | A single global resource (100 → 0) spent on every reality-altering command |
| Glitch System | Visual/gameplay corruption that scales in four tiers as Stability drops |
| Enemies | Seeker (hunts you), Guardian (patrols), Glitch (phases in/out, appears at low stability) |
| NOVA Dialogue | Context-aware lines tied to level progress, first-command use, and Stability tier |
| Endings | Three distinct endings determined by your Stability at the moment you finish the game |

## Reality Stability System

Reality Stability starts at 100% and only ever recovers through the costly **Emergency Stabilize** command (long cooldown, no direct action cost). Every other command has a flat percentage cost. The game reacts in four bands:

- **100–70%** — Normal gameplay, minimal ambient effects.
- **70–40%** — Minor glitches: scanline/overlay flicker, subtle screen distortion.
- **40–20%** — Major glitches: enemies become faster/more erratic, platforms flicker in and out, occasional RGB-split rendering, ambient glitch sounds.
- **20–0%** — Critical instability: heavy screen shake, corrupted title text, aggressive RGB split, Glitch-type enemies phase unpredictably.
- **0%** — **REALITY COLLAPSE**: an immediate dramatic game-over.

Your Stability carries across levels (it is not refilled between levels), so early spending has consequences much later — but a level restart (after a death or from the pause menu) grants a fresh attempt at full Stability, so a bad run never permanently locks you out.

## NOVA AI

NOVA is a character, not a static tooltip. She greets you at 100% integrity, reacts the first time you alter a "system variable," questions your reverse-gravity trick in Level 2, grows openly suspicious by the Corruption level, and has a distinct line for every ending. Dialogue is throttled and queued so it never overlaps or spams the screen during fast play.

## Natural Language Command System

The console accepts free text. Input is lowercased, stripped of punctuation, and matched against a registry of ten commands (each with a list of natural aliases) in three passes: exact alias match → substring containment → keyword overlap scoring. Examples that all resolve to the same command:

- `reverse gravity`, `flip gravity`, `invert gravity`, `reverse the gravity`
- `freeze enemy`, `freeze enemies`, `stop the enemies`, `halt enemies`
- `remove wall`, `make this wall disappear`, `turn this wall into a door`

**Security note:** no player input is ever executed as code. There is no `eval()`, no `Function()` constructor, and no dynamic code execution anywhere in the codebase. Every recognized command maps to one of ten fixed, hand-written effect functions in `CommandManager._applyEffect()`. Unrecognized input simply produces a "NOVA: I don't recognize that instruction." message and costs nothing.

### Command Registry

| Command | Cost | Cooldown | Duration |
|---|---|---|---|
| Reverse Gravity | 12% | 8s | 5s |
| Freeze Enemies | 15% | 10s | 4s |
| Slow Enemies | 8% | 6s | 6s |
| Create Platform | 10% | 5s | 8s |
| Remove Barrier | 14% | 9s | instant |
| Temporary Invisibility | 16% | 12s | 5s |
| Short Teleport | 9% | 6s | instant |
| Time Slow | 20% | 14s | 4s |
| Reveal Hidden Path | 6% | 10s | instant |
| Emergency Stabilize | 0% (restores 25%) | 45s | instant |

All values live in one place — `COMMANDS` in `game.js` — for easy rebalancing.

## A Note on AI-Backed Interpretation

An earlier version of this brief called for routing command text through the Gemini API. That was deliberately **not** implemented, for two reasons that matter for a static, competition-ready deploy: (1) the project ships as a static frontend with no backend, so any API key embedded client-side would be exposed publicly, and (2) the project's own security requirement — "never execute arbitrary code, never trust player input directly" — is best satisfied by a fully local, auditable interpreter with a fixed, safe action set. The local alias/keyword interpreter in `CommandManager.interpret()` fulfills the "understands natural-language variation" requirement without a network dependency, an API key, or unbounded model output driving gameplay.

## Technology Stack

- HTML5
- CSS3 (custom cyberpunk/glitch visual system, no CSS framework)
- Vanilla JavaScript (ES6 classes, no bundler, no npm dependencies)
- Canvas 2D API for rendering
- Web Audio API for procedural sound effects (no audio files)
- `localStorage` for save data (highest level reached, best ending, audio/motion settings)

## Project Architecture

```
glitched-reality/
├── index.html        # All screens: menu, how-to-play, AI lab, credits, game, overlays
├── style.css          # Cyberpunk/glitch visual system, responsive layout, glitch tiers
├── game.js            # Entire engine (see module list below)
├── vercel.json         # Static hosting config
├── README.md
├── assets/
│   ├── images/         # Empty — all visuals are drawn procedurally on canvas
│   └── audio/          # Empty — all sound is generated via Web Audio API
└── screenshots/
```

`game.js` is organized into clearly separated modules/classes:

- `CONFIG` / `COMMANDS` — all tunable values in one place
- `AudioManager` — procedural WebAudio sound effects, mute toggle
- `SaveManager` — localStorage persistence with graceful failure handling
- `ParticleSystem` — lightweight, capped particle pool
- `DialogueManager` — NOVA's queued, non-overlapping dialogue
- `RealityManager` — Stability value + glitch tier transitions
- `CommandManager` — natural-language interpretation + safe effect execution
- `Player`, `Enemy` — entity state
- `buildLevels()` — all 5 level layouts as data
- `UIManager` — DOM/HUD updates
- `Game` — main loop, physics, collision, camera, rendering, flow control

## Controls

```
A / Left Arrow   Move left
D / Right Arrow  Move right
W / Up / Space   Jump
E                Interact
ESC              Pause
ENTER            Focus command console / execute command
```

## Installation

No build step is required.

```bash
git clone <your-repo-url>
cd glitched-reality
```

## Local Development

Because the game uses `fetch`-free, dependency-free vanilla JS, you can open `index.html` directly in a browser, or serve it locally to avoid any browser file:// restrictions:

```bash
npx serve .
# or
python3 -m http.server 8080
```

Then open the printed local URL in your browser.

## Vercel Deployment

1. Create a GitHub repository and push this project to it.
2. Open [vercel.com](https://vercel.com) and sign in.
3. Click **Import Project** and select your GitHub repository.
4. Leave the framework preset as **Other** (no build command needed — it's static).
5. Click **Deploy**.
6. Open the generated URL, e.g. `https://your-project-name.vercel.app`.

## AI-Assisted Development

This project was designed and built through a structured, iterative sequence of prompts (see the in-game **AI LAB** menu for the visual version of this pipeline):

```
IDEA
 ↓
GAME DESIGN PROMPT      — define the core loop and central mechanic
 ↓
ARCHITECTURE PROMPT     — define modules, config-driven values, data-driven levels
 ↓
GAMEPLAY PROMPT         — implement physics, commands, enemies, levels, NOVA
 ↓
VISUAL DESIGN PROMPT    — cyberpunk/glitch identity, tiered glitch system
 ↓
TESTING PROMPT          — QA pass across commands, stability tiers, edge cases
 ↓
FINAL GAME
```

## Prompting Methodology

The build followed a design-first approach: the reality-stability economy and command registry were specified as data (cost/cooldown/duration/aliases) before any rendering code was written, so gameplay balance could be tuned independently of the engine. Levels were likewise defined as plain data objects (`buildLevels()`) rather than hard-coded logic, so difficulty and layout changes never require touching the physics or command systems.

## Testing

Manual QA covered:

- Movement, jumping, collision, and camera across all five levels
- Every command and every listed alias
- Stability behavior at 100%, 70%, 40%, 20%, and 0%
- Menu navigation, pause/resume, restart, and quit-to-menu flows
- `localStorage` persistence and graceful failure when storage is unavailable
- Edge cases: empty command input, unrecognized input, command spam, commands issued during cooldown, falling off the level, dying mid-ability, reaching 0% stability, restarting after collapse, and page refresh

## Future Improvements

- Additional command types and a deeper alias/synonym dictionary
- A save-anywhere checkpoint system within a level (currently level-granular)
- Gamepad support
- Additional enemy archetypes for later levels

## Credits

```
GAME CREATED BY
[YOUR NAME]

AI DESIGN & DEVELOPMENT
Claude / AI-assisted development

TECHNOLOGY
HTML5
CSS3
JavaScript
Canvas API

BUILT FOR
[COMPETITION NAME]
```
