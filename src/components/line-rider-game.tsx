"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Play,
  RotateCcw,
  Undo2,
  Trash2,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  X,
  Check,
  ArrowRight,
  Minus,
  Zap,
  Eraser,
} from "lucide-react";
import { LEVELS, type GameLine, type Level, type LineType, type Vec } from "@/lib/levels";

/* ------------------------------------------------------------------ */
/* Physics constants                                                   */
/* ------------------------------------------------------------------ */

// Tuned for a gentle, forgiving sled feel: light gravity, low drag so it
// keeps gliding (rarely gets stuck), a generous collision radius, and very
// lenient lose conditions so small mistakes aren't punished.
const GRAVITY = 0.03;
const SUBSTEPS = 6;
const RADIUS = 5; // slightly larger → collides earlier, fewer pinches at joins
const FRICTION = 0.993; // per-substep drag (low → coasts a long way)
const BOOST = 0.18;
const MAX_SPEED = 1.7;
const STUCK_FRAMES = 320; // ~5s of being truly stopped → "stuck"
const STUCK_SPEED = 0.03; // below this counts as stopped
const STUCK_GRACE = 60; // first ~1s of a run is never counted as stuck

// Playback speed options (also keyboard-cycleable with , and .).
const SPEEDS = [0.25, 0.5, 1, 2] as const;

const PALETTE = {
  bg: "#f5f2ec",
  grid: "#e7e2d8",
  ink: "#1c1917",
  muted: "#a8a29e",
  boost: "#ea580c",
  boostSoft: "rgba(234,88,12,0.18)",
  goal: "#ca8a04",
  goalSoft: "rgba(202,138,4,0.14)",
  sled: "#b91c1c",
  body: "#1c1917",
  head: "#fbbf24",
  trail: "rgba(185,28,28,0.22)",
  fixed: "#3f3f46",
};

/* ------------------------------------------------------------------ */
/* Math + physics (pure, module scope)                                 */
/* ------------------------------------------------------------------ */

function closestPointOnSegment(
  px: number, py: number,
  x1: number, y1: number, x2: number, y2: number,
): { x: number; y: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { x: x1 + t * dx, y: y1 + t * dy };
}

function distToSegment(
  px: number, py: number,
  x1: number, y1: number, x2: number, y2: number,
): number {
  const c = closestPointOnSegment(px, py, x1, y1, x2, y2);
  return Math.hypot(px - c.x, py - c.y);
}

function resolveCollision(
  rider: { x: number; y: number; vx: number; vy: number },
  line: { x1: number; y1: number; x2: number; y2: number; type: LineType },
): boolean {
  const lx = line.x2 - line.x1;
  const ly = line.y2 - line.y1;
  const ll = Math.hypot(lx, ly);
  if (ll < 0.0001) return false;
  const dirx = lx / ll;
  const diry = ly / ll;

  // Project the rider onto the segment, keeping t so we can tell when the
  // contact is at an endpoint (a rounded cap) vs the middle (a flat edge).
  const t = ((rider.x - line.x1) * dirx + (rider.y - line.y1) * diry) / ll;
  const tc = Math.max(0, Math.min(1, t));
  const cpx = line.x1 + dirx * tc * ll;
  const cpy = line.y1 + diry * tc * ll;

  let dx = rider.x - cpx;
  let dy = rider.y - cpy;
  let dist = Math.hypot(dx, dy);
  if (dist >= RADIUS) return false;

  let nx: number;
  let ny: number;
  if (dist > 0.0001) {
    nx = dx / dist;
    ny = dy / dist;
  } else {
    // Sitting exactly on the line: use the line's up-normal.
    nx = -diry;
    ny = dirx;
    dist = 0;
  }

  const atEndpoint = t <= 0 || t >= 1;

  const vdotn = rider.vx * nx + rider.vy * ny;
  if (vdotn < 0) {
    // Full inelastic kill on flat edges; softer (60%) at endpoints so the
    // rider rolls around line ends instead of being ejected at gaps.
    const kill = atEndpoint ? 0.6 : 1.0;
    rider.vx -= nx * vdotn * kill;
    rider.vy -= ny * vdotn * kill;
  }

  let valong = rider.vx * dirx + rider.vy * diry;
  valong *= FRICTION;
  rider.vx = dirx * valong;
  rider.vy = diry * valong;

  rider.x = cpx + nx * RADIUS;
  rider.y = cpy + ny * RADIUS;

  if (line.type === "boost") {
    rider.vx += dirx * BOOST;
    rider.vy += diry * BOOST;
  }
  return true;
}

function clampSpeed(rider: { vx: number; vy: number }) {
  const s = Math.hypot(rider.vx, rider.vy);
  if (s > MAX_SPEED) {
    const k = MAX_SPEED / s;
    rider.vx *= k;
    rider.vy *= k;
  }
}

function lineLength(l: { x1: number; y1: number; x2: number; y2: number }): number {
  return Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
}

/* ------------------------------------------------------------------ */
/* Drawing (pure, module scope)                                        */
/* ------------------------------------------------------------------ */

function drawGrid(
  ctx: CanvasRenderingContext2D,
  cam: Vec & { zoom: number },
  vw: number,
  vh: number,
  zoom: number,
) {
  const step = 50;
  const left = cam.x;
  const top = cam.y;
  const right = cam.x + vw / zoom;
  const bottom = cam.y + vh / zoom;
  ctx.strokeStyle = PALETTE.grid;
  ctx.lineWidth = 1 / zoom;
  ctx.globalAlpha = 0.5;
  const x0 = Math.floor(left / step) * step;
  const y0 = Math.floor(top / step) * step;
  ctx.beginPath();
  for (let x = x0; x <= right; x += step) {
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
  }
  for (let y = y0; y <= bottom; y += step) {
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawLine(ctx: CanvasRenderingContext2D, l: GameLine, zoom: number) {
  ctx.lineCap = "round";
  if (l.type === "boost") {
    ctx.strokeStyle = PALETTE.boostSoft;
    ctx.lineWidth = 8 / zoom;
    ctx.beginPath();
    ctx.moveTo(l.x1, l.y1);
    ctx.lineTo(l.x2, l.y2);
    ctx.stroke();
    ctx.strokeStyle = PALETTE.boost;
    ctx.lineWidth = 3 / zoom;
    ctx.beginPath();
    ctx.moveTo(l.x1, l.y1);
    ctx.lineTo(l.x2, l.y2);
    ctx.stroke();
  } else {
    ctx.strokeStyle = l.fixed ? PALETTE.fixed : PALETTE.ink;
    ctx.lineWidth = (l.fixed ? 3 : 2.4) / zoom;
    ctx.beginPath();
    ctx.moveTo(l.x1, l.y1);
    ctx.lineTo(l.x2, l.y2);
    ctx.stroke();
  }
}

function drawStart(ctx: CanvasRenderingContext2D, p: Vec, zoom: number) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(1 / zoom, 1 / zoom);
  // Outer ring
  ctx.strokeStyle = "#57534e";
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.arc(0, 0, 9, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  // Center dot
  ctx.fillStyle = "#57534e";
  ctx.beginPath();
  ctx.arc(0, 0, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawGoal(ctx: CanvasRenderingContext2D, p: Vec, r: number, t: number, zoom: number) {
  const pulse = 0.5 + 0.5 * Math.sin(t * 0.004);

  // Ground catch-zone: a soft glow + a dashed ring on the floor.
  ctx.fillStyle = PALETTE.goalSoft;
  ctx.globalAlpha = 0.5 + pulse * 0.3;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.strokeStyle = PALETTE.goal;
  ctx.lineWidth = 1.8 / zoom;
  ctx.globalAlpha = 0.7;
  ctx.setLineDash([6 / zoom, 5 / zoom]);
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // Planted finish flag (constant screen size): pole + checkered banner.
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(1 / zoom, 1 / zoom);

  // Pole.
  ctx.strokeStyle = "#57534e";
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, -54);
  ctx.stroke();

  // Checkered banner at the top of the pole.
  const bw = 36;
  const bh = 22;
  const cols = 4;
  const rows = 2;
  const cw = bw / cols;
  const ch = bh / rows;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? PALETTE.goal : "#f5f2ec";
      ctx.fillRect(col * cw, -54 + row * ch, cw, ch);
    }
  }
  ctx.strokeStyle = PALETTE.goal;
  ctx.lineWidth = 1;
  ctx.strokeRect(0, -54, bw, bh);

  // Base marker (a small disc so the pole reads as planted).
  ctx.fillStyle = "#57534e";
  ctx.beginPath();
  ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawRider(ctx: CanvasRenderingContext2D, r: Rider, zoom: number) {
  // The sled faces right and tilts with its motion (angle set in step()).
  // The head is on a spring (headX/headY) so it wobbles like a bobble head.
  // The rider's collision centre (r.x,r.y) sits one RADIUS above the track;
  // we draw the sled so its runner sits right on the track surface, with the
  // stick man seated on top of it.
  const angle = r.angle;
  const s = 1.25;
  ctx.save();
  ctx.translate(r.x, r.y);
  ctx.scale((s) / zoom, (s) / zoom);
  ctx.rotate(angle);

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Local layout: the sled runner sits at y = +RADIUS (on the track).
  // The stick man sits on the sled: hips just above the runner.
  const sledY = 4; // runner line (≈ on the track)
  const hipY = sledY - 3; // hips just above the sled
  const shoulderY = hipY - 7; // torso height
  const neckTopY = shoulderY - 1;

  // Sled (red runner + tip up).
  ctx.strokeStyle = PALETTE.sled;
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(-10, sledY);
  ctx.lineTo(11, sledY);
  ctx.lineTo(13, sledY - 2);
  ctx.stroke();

  // Stick body (legs + torso + arms) in ink, seated on the sled.
  ctx.strokeStyle = PALETTE.body;
  ctx.lineWidth = 2;
  // Legs — bent, feet on the runner.
  ctx.beginPath();
  ctx.moveTo(-4, sledY);
  ctx.lineTo(-2, hipY + 1);
  ctx.lineTo(0, hipY);
  ctx.moveTo(5, sledY);
  ctx.lineTo(2, hipY + 1);
  ctx.lineTo(0, hipY);
  ctx.stroke();
  // Torso.
  ctx.beginPath();
  ctx.moveTo(0, hipY);
  ctx.lineTo(0, shoulderY);
  ctx.stroke();
  // Arms — counter-sway against the head for a lively wobble.
  const armSway = -r.headX * 0.18;
  ctx.beginPath();
  ctx.moveTo(0, shoulderY + 1);
  ctx.lineTo(-5 + armSway, shoulderY + 4);
  ctx.moveTo(0, shoulderY + 1);
  ctx.lineTo(5 + armSway, shoulderY + 4);
  ctx.stroke();

  // Springy neck — flexes toward wherever the head has bobbled to.
  const headRestY = neckTopY - 5;
  const headCX = r.headX;
  const headCY = headRestY + r.headY;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(0, neckTopY);
  ctx.quadraticCurveTo(headCX * 0.5, neckTopY - 2 + r.headY * 0.5, headCX, headCY + 3.5);
  ctx.stroke();

  // Head (bobble).
  ctx.fillStyle = PALETTE.head;
  ctx.strokeStyle = PALETTE.body;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(headCX, headCY, 3.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Game state                                                          */
/* ------------------------------------------------------------------ */

type Phase = "editing" | "playing" | "won" | "lost";
type Tool = "line" | "boost" | "erase";

/** Map an active tool to the line type it draws (erase has none). */
const TOOL_LINE_TYPE: Record<Exclude<Tool, "erase">, LineType> = {
  line: "normal",
  boost: "boost",
};
type LoseReason = "stuck" | "offcourse";

type Rider = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  // Bobble-head spring: offset of the head from its rest position, and
  // the spring velocity driving the wobble. Driven by per-step accel.
  headX: number;
  headY: number;
  headVX: number;
  headVY: number;
  prevVX: number;
  prevVY: number;
};

type GameState = {
  level: Level;
  playerLines: GameLine[];
  rider: Rider;
  camera: Vec & { zoom: number };
  // drawing input (freehand polyline stroke)
  drawingPath: { points: Vec[]; type: LineType } | null;
  nextStrokeId: number;
  panning: boolean;
  panLast: Vec | null;
  spaceDown: boolean;
  // history
  history: GameLine[][];
  // runtime
  trail: Vec[];
  stuckFrames: number;
  tick: number;
};

const PROGRESS_KEY = "line-glide-progress-v1";

function loadProgress(): number[] {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    return raw ? (JSON.parse(raw) as number[]) : [];
  } catch {
    return [];
  }
}
function saveProgress(ids: number[]) {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export default function LineRiderGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [levelIndex, setLevelIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("editing");
  const [tool, setTool] = useState<Tool>("line");
  const [speed, setSpeed] = useState(1); // playback multiplier: 0.25, 0.5, 1, 2
  const [usedBudget, setUsedBudget] = useState(0);
  const [loseReason, setLoseReason] = useState<LoseReason>("stuck");
  const [completed, setCompleted] = useState<number[]>(() => loadProgress());
  const [showHelp, setShowHelp] = useState(false);

  const level = LEVELS[levelIndex];

  const gameRef = useRef<GameState>({
    level: LEVELS[0],
    playerLines: [],
    rider: {
      x: LEVELS[0].start.x,
      y: LEVELS[0].start.y,
      vx: 0,
      vy: 0,
      angle: 0,
      headX: 0,
      headY: 0,
      headVX: 0,
      headVY: 0,
      prevVX: 0,
      prevVY: 0,
    },
    camera: { x: 0, y: 0, zoom: 1 },
    drawingPath: null,
    nextStrokeId: 1,
    panning: false,
    panLast: null,
    spaceDown: false,
    history: [],
    trail: [],
    stuckFrames: 0,
    tick: 0,
  });

  // Refs so the once-registered RAF/input loop reads live values.
  const phaseRef = useRef(phase);
  const toolRef = useRef(tool);
  const speedRef = useRef(speed);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  // Action refs (keydown calls these; synced via effect to satisfy lint).
  const playRef = useRef<() => void>(() => {});
  const resetRef = useRef<() => void>(() => {});
  const undoRef = useRef<() => void>(() => {});
  const loadLevelRef = useRef<(idx: number) => void>(() => {});

  const screenToWorld = useCallback((sx: number, sy: number): Vec => {
    const g = gameRef.current;
    return {
      x: g.camera.x + sx / g.camera.zoom,
      y: g.camera.y + sy / g.camera.zoom,
    };
  }, []);

  /* ---------------------------------------------------------------- */
  /* Level loading                                                     */
  /* ---------------------------------------------------------------- */

  const fitToLevel = useCallback((lvl: Level) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const pts: Vec[] = [lvl.start, lvl.goal, ...lvl.lines.flatMap((l) => [{ x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 }])];
    const minX = Math.min(...pts.map((p) => p.x));
    const maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    const maxY = Math.max(...pts.map((p) => p.y));
    const pad = 90;
    const bw = maxX - minX + pad * 2;
    const bh = maxY - minY + pad * 2;
    const zoom = Math.max(0.25, Math.min(1.4, Math.min(rect.width / bw, rect.height / bh)));
    const g = gameRef.current;
    g.camera.zoom = zoom;
    g.camera.x = (minX + maxX) / 2 - rect.width / 2 / zoom;
    g.camera.y = (minY + maxY) / 2 - rect.height / 2 / zoom;
  }, []);

  // (Re)load a level into the game state. Called from nav buttons (event
  // handlers, not effects) so the setState calls are lint-clean.
  const loadLevel = useCallback(
    (idx: number) => {
      const lvl = LEVELS[idx];
      const g = gameRef.current;
      g.level = lvl;
      g.playerLines = [];
      g.rider = {
        x: lvl.start.x,
        y: lvl.start.y,
        vx: 0,
        vy: 0,
        angle: 0,
        headX: 0,
        headY: 0,
        headVX: 0,
        headVY: 0,
        prevVX: 0,
        prevVY: 0,
      };
      g.history = [];
      g.trail = [];
      g.stuckFrames = 0;
      g.drawingPath = null;
      g.panning = false;
      setLevelIndex(idx);
      setPhase("editing");
      setUsedBudget(0);
      // Refit the camera once layout has settled. Multiple rapid nav clicks
      // just queue a few fits; the last one wins — harmless.
      requestAnimationFrame(() => fitToLevel(lvl));
    },
    [fitToLevel],
  );

  // Initial camera fit on mount (no setState here).
  useEffect(() => {
    const id = requestAnimationFrame(() => fitToLevel(LEVELS[0]));
    return () => cancelAnimationFrame(id);
  }, [fitToLevel]);

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */

  const pushHistory = useCallback(() => {
    const g = gameRef.current;
    g.history.push(g.playerLines.map((l) => ({ ...l })));
    if (g.history.length > 80) g.history.shift();
  }, []);

  const recomputeBudget = useCallback(() => {
    const g = gameRef.current;
    const used = g.playerLines.reduce((s, l) => s + lineLength(l), 0);
    setUsedBudget(Math.round(used));
  }, []);

  const play = useCallback(() => {
    const g = gameRef.current;
    if (phaseRef.current === "playing") return;
    g.rider = {
      x: g.level.start.x,
      y: g.level.start.y,
      vx: 0,
      vy: 0,
      angle: 0,
      headX: 0,
      headY: 0,
      headVX: 0,
      headVY: 0,
      prevVX: 0,
      prevVY: 0,
    };
    g.trail = [];
    // Negative grace so the launch (rider briefly stationary) isn't
    // mistaken for being stuck.
    g.stuckFrames = -STUCK_GRACE;
    setPhase("playing");
  }, []);

  const reset = useCallback(() => {
    const g = gameRef.current;
    g.rider = {
      x: g.level.start.x,
      y: g.level.start.y,
      vx: 0,
      vy: 0,
      angle: 0,
      headX: 0,
      headY: 0,
      headVX: 0,
      headVY: 0,
      prevVX: 0,
      prevVY: 0,
    };
    g.trail = [];
    g.stuckFrames = 0;
    // Returning to edit mode snaps the view back to the level's framing.
    fitToLevel(g.level);
    setPhase("editing");
  }, [fitToLevel]);

  const undo = useCallback(() => {
    const g = gameRef.current;
    const prev = g.history.pop();
    if (prev) {
      g.playerLines = prev;
    } else if (g.playerLines.length > 0) {
      g.playerLines.pop();
    }
    recomputeBudget();
  }, [recomputeBudget]);

  // Click the speed chip to cycle 0.25 → 0.5 → 1 → 2 → 0.25 …
  const cycleSpeed = useCallback(() => {
    setSpeed((s) => {
      const i = SPEEDS.indexOf(s as (typeof SPEEDS)[number]);
      return SPEEDS[(i + 1) % SPEEDS.length];
    });
  }, []);

  const clearAll = useCallback(() => {
    const g = gameRef.current;
    if (g.playerLines.length === 0) return;
    pushHistory();
    g.playerLines = [];
    recomputeBudget();
  }, [pushHistory, recomputeBudget]);

  const nextLevel = useCallback(() => {
    loadLevel(Math.min(LEVELS.length - 1, levelIndex + 1));
  }, [levelIndex, loadLevel]);
  const prevLevel = useCallback(() => {
    loadLevel(Math.max(0, levelIndex - 1));
  }, [levelIndex, loadLevel]);

  // Sync action refs.
  useEffect(() => {
    playRef.current = play;
    resetRef.current = reset;
    undoRef.current = undo;
    loadLevelRef.current = loadLevel;
  }, [play, reset, undo, loadLevel]);

  /* ---------------------------------------------------------------- */
  /* Setup: canvas, input, render + physics loop                       */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const canvas = canvasRef.current!;
    const container = containerRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));

    const resize = () => {
      const rect = container.getBoundingClientRect();
      dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const getPos = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const eraseAt = (pos: Vec) => {
      const g = gameRef.current;
      const world = screenToWorld(pos.x, pos.y);
      const threshold = 10 / g.camera.zoom;
      let bestIdx = -1;
      let bestDist = threshold;
      for (let i = 0; i < g.playerLines.length; i++) {
        const l = g.playerLines[i];
        const d = distToSegment(world.x, world.y, l.x1, l.y1, l.x2, l.y2);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) {
        pushHistory();
        const hit = g.playerLines[bestIdx];
        if (hit.strokeId != null) {
          // Remove the whole freehand stroke in one go.
          g.playerLines = g.playerLines.filter((l) => l.strokeId !== hit.strokeId);
        } else {
          g.playerLines.splice(bestIdx, 1);
        }
        recomputeBudget();
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const pos = getPos(e);
      const g = gameRef.current;

      // Editing only — no drawing while playing/won/lost.
      if (phaseRef.current !== "editing") {
        if (e.button === 1 || g.spaceDown) {
          g.panning = true;
          g.panLast = pos;
        }
        return;
      }

      if (e.button === 2) {
        eraseAt(pos);
        return;
      }
      if (e.button === 1 || g.spaceDown) {
        g.panning = true;
        g.panLast = pos;
        return;
      }

      const activeTool = toolRef.current;
      if (activeTool === "erase") {
        eraseAt(pos);
        return;
      }

      const world = screenToWorld(pos.x, pos.y);
      g.drawingPath = {
        points: [world],
        type: TOOL_LINE_TYPE[activeTool],
      };
    };

    const onPointerMove = (e: PointerEvent) => {
      const pos = getPos(e);
      const g = gameRef.current;
      if (g.panning && g.panLast) {
        const dx = (pos.x - g.panLast.x) / g.camera.zoom;
        const dy = (pos.y - g.panLast.y) / g.camera.zoom;
        g.camera.x -= dx;
        g.camera.y -= dy;
        g.panLast = pos;
        return;
      }
      if (g.drawingPath && phaseRef.current === "editing") {
        const world = screenToWorld(pos.x, pos.y);
        const pts = g.drawingPath.points;
        const last = pts[pts.length - 1];
        const d = Math.hypot(world.x - last.x, world.y - last.y);
        const sample = 4 / g.camera.zoom;
        if (d > sample) {
          // Respect the remaining track budget across the whole stroke.
          const used = g.playerLines.reduce((s, l) => s + lineLength(l), 0);
          let pathLen = 0;
          for (let i = 1; i < pts.length; i++) {
            pathLen += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
          }
          const remaining = Math.max(0, g.level.budget - used - pathLen);
          if (d <= remaining) {
            pts.push(world);
          } else if (remaining > sample) {
            const t = remaining / d;
            pts.push({ x: last.x + (world.x - last.x) * t, y: last.y + (world.y - last.y) * t });
          }
        }
      }
    };

    const finishPointer = (e: PointerEvent) => {
      const g = gameRef.current;
      if (g.drawingPath) {
        const pts = g.drawingPath.points;
        if (pts.length >= 2) {
          pushHistory();
          const sid = g.nextStrokeId;
          g.nextStrokeId += 1;
          for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1];
            const b = pts[i];
            if (Math.hypot(b.x - a.x, b.y - a.y) > 1) {
              g.playerLines.push({
                x1: a.x,
                y1: a.y,
                x2: b.x,
                y2: b.y,
                type: g.drawingPath.type,
                strokeId: sid,
              });
            }
          }
          recomputeBudget();
        }
      }
      g.drawingPath = null;
      g.panning = false;
      g.panLast = null;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };

    const onPointerUp = (e: PointerEvent) => finishPointer(e);
    const onPointerCancel = (e: PointerEvent) => finishPointer(e);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const g = gameRef.current;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const before = screenToWorld(sx, sy);
      const factor = Math.exp(-e.deltaY * 0.0015);
      g.camera.zoom = Math.max(0.2, Math.min(4, g.camera.zoom * factor));
      const after = screenToWorld(sx, sy);
      g.camera.x += before.x - after.x;
      g.camera.y += before.y - after.y;
    };

    const onContextMenu = (e: Event) => e.preventDefault();

    const onKeyDown = (e: KeyboardEvent) => {
      const g = gameRef.current;
      if (e.code === "Space") {
        g.spaceDown = true;
        if (!e.repeat) {
          e.preventDefault();
          if (phaseRef.current === "playing") resetRef.current();
          else playRef.current();
        }
      } else if (e.key === "r" || e.key === "R") {
        resetRef.current();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        undoRef.current();
      } else if (e.key === "1") setTool("line");
      else if (e.key === "2") setTool("boost");
      else if (e.key === "3") setTool("erase");
      else if (e.key === "ArrowRight" && phaseRef.current !== "playing") {
        const g = gameRef.current;
        const idx = LEVELS.findIndex((l) => l.id === g.level.id);
        loadLevelRef.current(Math.min(LEVELS.length - 1, idx + 1));
      } else if (e.key === "ArrowLeft" && phaseRef.current !== "playing") {
        const g = gameRef.current;
        const idx = LEVELS.findIndex((l) => l.id === g.level.id);
        loadLevelRef.current(Math.max(0, idx - 1));
      } else if (e.key === "," || e.key === "<") {
        const cur = SPEEDS.indexOf(speedRef.current as (typeof SPEEDS)[number]);
        setSpeed(SPEEDS[Math.max(0, cur - 1)]);
      } else if (e.key === "." || e.key === ">") {
        const cur = SPEEDS.indexOf(speedRef.current as (typeof SPEEDS)[number]);
        setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, cur + 1)]);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") gameRef.current.spaceDown = false;
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    /* ------------------ physics step ------------------ */

    const step = () => {
      const g = gameRef.current;
      if (phaseRef.current !== "playing") return;
      const lvl = g.level;
      const r = g.rider;
      const allLines: GameLine[] = [...lvl.lines, ...g.playerLines];

      // Integrate. Clamping before the position update keeps every
      // substep's move below RADIUS so the rider can't tunnel through
      // a line between checks.
      for (let s = 0; s < SUBSTEPS; s++) {
        r.vy += GRAVITY;
        clampSpeed(r);
        r.x += r.vx;
        r.y += r.vy;
        for (const l of allLines) resolveCollision(r, l);
      }

      const speed = Math.hypot(r.vx, r.vy);

      // Sled always faces right and tilts with its vertical motion,
      // clamped so it can never appear to flip upside-down (no ±π wrap).
      if (speed > 0.1) {
        const target = Math.max(-0.6, Math.min(0.6, Math.atan2(r.vy, Math.abs(r.vx))));
        r.angle += (target - r.angle) * 0.2;
      }

      // Bobble head: a damped spring driven by the rider's acceleration
      // (in the sled's local frame so it bobs forward/back + up/down
      // relative to the body). Collisions give a big spike → big wobble.
      // A faint idle "breath" keeps the character alive when stationary.
      const ax = r.vx - r.prevVX;
      const ay = r.vy - r.prevVY;
      r.prevVX = r.vx;
      r.prevVY = r.vy;
      const ca = Math.cos(-r.angle);
      const sa = Math.sin(-r.angle);
      const lax = ax * ca - ay * sa;
      const lay = ax * sa + ay * ca;
      const targetHX = Math.max(-7, Math.min(7, -lax * 9));
      let targetHY = Math.max(-6, Math.min(6, -lay * 9));
      if (speed < 0.12) {
        // Gentle breathing bob when nearly still.
        targetHY += Math.sin(g.tick * 0.05) * 0.6;
      }
      r.headVX += (targetHX - r.headX) * 0.3;
      r.headVY += (targetHY - r.headY) * 0.3;
      r.headVX *= 0.84; // a touch less damping → livelier wobble
      r.headVY *= 0.88;
      r.headX += r.headVX;
      r.headY += r.headVY;
      g.tick++;

      g.trail.push({ x: r.x, y: r.y });
      if (g.trail.length > 64) g.trail.shift();

      // Camera follow — eased for a calmer ride.
      const rect = container.getBoundingClientRect();
      const targetX = r.x - rect.width / 2 / g.camera.zoom;
      const targetY = r.y - rect.height / 2 / g.camera.zoom;
      g.camera.x += (targetX - g.camera.x) * 0.08;
      g.camera.y += (targetY - g.camera.y) * 0.08;

      // Win — reach the flag. Stop the rider cleanly so it doesn't
      // visibly skate through the finish.
      if (Math.hypot(r.x - lvl.goal.x, r.y - lvl.goal.y) < lvl.goalRadius) {
        r.vx = 0;
        r.vy = 0;
        setPhase("won");
        setCompleted((prev) => {
          if (prev.includes(lvl.id)) return prev;
          const next = [...prev, lvl.id];
          saveProgress(next);
          return next;
        });
        return;
      }

      // Lose — off course (very generous; only truly lost runs end here).
      const offX = r.x < lvl.start.x - 1000 || r.x > lvl.goal.x + 1200;
      const offY = r.y > lvl.goal.y + 900 || r.y < lvl.start.y - 900;
      if (offX || offY) {
        setLoseReason("offcourse");
        setPhase("lost");
        return;
      }

      // Lose — stuck. The negative grace set at launch is eaten first,
      // so a brief stationary moment at the start never counts.
      if (speed < STUCK_SPEED) {
        g.stuckFrames++;
      } else {
        g.stuckFrames = 0;
      }
      if (g.stuckFrames > STUCK_FRAMES) {
        setLoseReason("stuck");
        setPhase("lost");
        return;
      }
    };

    /* ------------------ render ------------------ */

    const render = (t: number) => {
      const g = gameRef.current;
      const w = canvas.width;
      const h = canvas.height;
      const zoom = g.camera.zoom;
      const lvl = g.level;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = PALETTE.bg;
      ctx.fillRect(0, 0, w / dpr, h / dpr);

      ctx.save();
      ctx.scale(zoom, zoom);
      ctx.translate(-g.camera.x, -g.camera.y);

      drawGrid(ctx, g.camera, w / dpr, h / dpr, zoom);

      // Fixed lines first (so player lines render on top).
      for (const l of lvl.lines) drawLine(ctx, l, zoom);
      for (const l of g.playerLines) drawLine(ctx, l, zoom);

      // Live drawing preview (freehand polyline).
      if (g.drawingPath && g.drawingPath.points.length > 0) {
        const pts = g.drawingPath.points;
        const previewColor = g.drawingPath.type === "boost" ? PALETTE.boost : PALETTE.ink;
        ctx.save();
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = 2 / zoom;
        ctx.strokeStyle = previewColor;
        ctx.setLineDash([6 / zoom, 4 / zoom]);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
        ctx.restore();
      }

      drawStart(ctx, lvl.start, zoom);
      drawGoal(ctx, lvl.goal, lvl.goalRadius, t, zoom);

      // Trail.
      if (g.trail.length > 1) {
        ctx.strokeStyle = PALETTE.trail;
        ctx.lineWidth = 2 / zoom;
        ctx.beginPath();
        ctx.moveTo(g.trail[0].x, g.trail[0].y);
        for (let i = 1; i < g.trail.length; i++) ctx.lineTo(g.trail[i].x, g.trail[i].y);
        ctx.stroke();
      }

      drawRider(ctx, g.rider, zoom);

      ctx.restore();
    };

    let timeAcc = 0; // accumulator for fractional playback speeds
    const loop = (t: number) => {
      // Run the physics step `speed` times per render frame (an accumulator
      // handles fractional speeds like 0.5× and 0.25× for slow motion).
      timeAcc += speedRef.current;
      let guard = 0;
      while (timeAcc >= 1 && guard < 8) {
        step();
        timeAcc -= 1;
        guard++;
      }
      if (timeAcc > 1) timeAcc = 1; // avoid runaway after tab switches
      render(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [screenToWorld, pushHistory, recomputeBudget]);

  /* ---------------------------------------------------------------- */
  /* Derived                                                           */
  /* ---------------------------------------------------------------- */

  const budgetPct = Math.min(100, (usedBudget / level.budget) * 100);
  const budgetLow = budgetPct > 90;
  const isLastLevel = levelIndex === LEVELS.length - 1;

  const onPlayClick = () => {
    if (phase === "playing") reset();
    else play();
  };

  const tools: { id: Tool; label: string; icon: React.ReactNode }[] = [
    { id: "line", label: "Line", icon: <Minus className="h-4 w-4" /> },
    { id: "boost", label: "Boost", icon: <Zap className="h-4 w-4" /> },
    { id: "erase", label: "Erase", icon: <Eraser className="h-4 w-4" /> },
  ];

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  return (
    <div className="flex h-screen flex-col bg-[#f5f2ec] text-stone-900 overflow-hidden">
      {/* Top bar — slim, single row */}
      <header className="flex h-12 shrink-0 items-center gap-2 px-3 sm:px-4">
        {/* Level nav */}
        <div className="flex items-center gap-1">
          <button
            onClick={prevLevel}
            disabled={levelIndex === 0 || phase === "playing"}
            className="flex h-7 w-7 items-center justify-center rounded-md text-stone-400 transition hover:bg-stone-200/50 hover:text-stone-900 disabled:opacity-25 disabled:hover:bg-transparent"
            aria-label="Previous level"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="font-mono text-xs tabular-nums text-stone-400">
              {String(level.id).padStart(2, "0")}
            </span>
            <span className="truncate text-sm font-medium tracking-tight">
              {level.name}
            </span>
            {completed.includes(level.id) && (
              <Check className="h-3 w-3 text-green-600" />
            )}
          </div>
          <button
            onClick={nextLevel}
            disabled={isLastLevel || phase === "playing"}
            className="flex h-7 w-7 items-center justify-center rounded-md text-stone-400 transition hover:bg-stone-200/50 hover:text-stone-900 disabled:opacity-25 disabled:hover:bg-transparent"
            aria-label="Next level"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1" />

        {/* Budget — compact pill */}
        <div className="hidden items-center gap-2 sm:flex">
          <div className="h-1 w-20 overflow-hidden rounded-full bg-stone-200 lg:w-28">
            <div
              className={`h-full rounded-full transition-all duration-200 ${
                budgetLow ? "bg-orange-600" : "bg-stone-800"
              }`}
              style={{ width: `${budgetPct}%` }}
            />
          </div>
          <span className="w-12 text-right font-mono text-[11px] tabular-nums text-stone-400">
            {usedBudget}/{level.budget}
          </span>
        </div>

        {/* Speed — click to cycle */}
        <button
          onClick={cycleSpeed}
          className="flex h-7 items-center gap-1 rounded-md bg-stone-200/60 px-2 text-[11px] font-medium tabular-nums text-stone-700 transition hover:bg-stone-200 hover:text-stone-900"
          aria-label={`Playback speed ${speed}× — click to change`}
          title="Click to cycle speed"
        >
          {speed === 0.25 ? "¼" : speed === 0.5 ? "½" : `${speed}`}×
        </button>

        {/* Run / Stop */}
        <button
          onClick={onPlayClick}
          className={`flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-medium text-white transition ${
            phase === "playing"
              ? "bg-stone-600 hover:bg-stone-500"
              : "bg-stone-900 hover:bg-stone-800"
          }`}
        >
          {phase === "playing" ? (
            <>
              <RotateCcw className="h-3.5 w-3.5" /> Stop
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5" /> Run
            </>
          )}
        </button>
      </header>

      {/* Canvas stage */}
      <main ref={containerRef} className="relative min-h-0 flex-1">
        <canvas className="absolute inset-0 h-full w-full touch-none select-none" ref={canvasRef} />

        {/* Floating tool dock — bottom center */}
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-3">
          <div className="pointer-events-auto flex items-center gap-0.5 rounded-xl border border-stone-200/80 bg-white/85 p-1 shadow-sm backdrop-blur-md">
            {tools.map((t) => (
              <button
                key={t.id}
                onClick={() => setTool(t.id)}
                className={`flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition sm:px-2.5 ${
                  tool === t.id
                    ? t.id === "boost"
                      ? "bg-orange-600 text-white"
                      : "bg-stone-900 text-white"
                    : "text-stone-500 hover:bg-stone-100 hover:text-stone-900"
                }`}
                aria-label={t.label}
                aria-pressed={tool === t.id}
              >
                {t.icon}
                <span className="hidden md:inline">{t.label}</span>
              </button>
            ))}
            <div className="mx-0.5 h-5 w-px bg-stone-200" />
            <button
              onClick={undo}
              disabled={phase === "playing"}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 disabled:opacity-30"
              aria-label="Undo"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              onClick={clearAll}
              disabled={phase === "playing"}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 disabled:opacity-30"
              aria-label="Clear all"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Mobile budget pill */}
        <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full border border-stone-200/70 bg-white/80 px-3 py-1 backdrop-blur sm:hidden">
          <div className="h-1.5 w-14 overflow-hidden rounded-full bg-stone-200">
            <div
              className={`h-full ${budgetLow ? "bg-orange-600" : "bg-stone-800"}`}
              style={{ width: `${budgetPct}%` }}
            />
          </div>
          <span className="font-mono text-[10px] tabular-nums text-stone-500">
            {usedBudget}/{level.budget}
          </span>
        </div>

        {/* Hint */}
        {phase === "editing" && (
          <div className="pointer-events-none absolute left-3 top-3 max-w-xs rounded-lg bg-white/70 px-3 py-1.5 text-xs text-stone-500 backdrop-blur sm:left-auto sm:right-3">
            {level.hint}
          </div>
        )}

        {/* Help */}
        <button
          onClick={() => setShowHelp((s) => !s)}
          className="absolute bottom-4 right-3 flex h-7 w-7 items-center justify-center rounded-full border border-stone-200/70 bg-white/80 text-stone-400 backdrop-blur transition hover:text-stone-900"
          aria-label="Help"
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
        {showHelp && (
          <div className="absolute bottom-12 right-3 w-56 rounded-xl border border-stone-200 bg-white p-4 text-xs text-stone-600 shadow-lg">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-stone-900">Controls</span>
              <button onClick={() => setShowHelp(false)} className="text-stone-400 hover:text-stone-900">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <ul className="space-y-1">
              <li><span className="font-mono text-stone-400">drag</span> — draw a line or curve</li>
              <li><span className="font-mono text-stone-400">right-click</span> — erase a stroke</li>
              <li><span className="font-mono text-stone-400">space + drag</span> — pan</li>
              <li><span className="font-mono text-stone-400">scroll</span> — zoom</li>
              <li><span className="font-mono text-stone-400">1 2 3</span> — line / boost / erase</li>
              <li><span className="font-mono text-stone-400">space</span> — run / stop</li>
              <li><span className="font-mono text-stone-400">, .</span> — slower / faster</li>
              <li><span className="font-mono text-stone-400">← →</span> — prev / next level</li>
              <li><span className="font-mono text-stone-400">R</span> — reset rider</li>
              <li><span className="font-mono text-stone-400">⌘Z</span> — undo</li>
            </ul>
            <p className="mt-3 border-t border-stone-100 pt-2 text-[11px] leading-relaxed text-stone-400">
              <span className="font-medium text-orange-600">Boost</span> lines push you along. Drag to draw straight or curved. Reach the gold flag.
            </p>
          </div>
        )}

        {/* Win overlay */}
        {phase === "won" && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#f5f2ec]/60 backdrop-blur-sm">
            <div className="w-72 rounded-2xl border border-stone-200 bg-white p-6 text-center shadow-xl">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-green-100">
                <Check className="h-5 w-5 text-green-600" />
              </div>
              <h2 className="text-lg font-semibold tracking-tight">Level complete</h2>
              <p className="mt-1 text-xs text-stone-500">
                {isLastLevel ? "You finished every level." : `Track used: ${usedBudget} of ${level.budget}`}
              </p>
              <div className="mt-5 flex gap-2">
                <button
                  onClick={reset}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-700 transition hover:bg-stone-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Replay
                </button>
                {!isLastLevel ? (
                  <button
                    onClick={nextLevel}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-stone-800"
                  >
                    Next <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <button
                    onClick={() => loadLevel(0)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-stone-800"
                  >
                    Level 1
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Lose overlay */}
        {phase === "lost" && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#f5f2ec]/60 backdrop-blur-sm">
            <div className="w-72 rounded-2xl border border-stone-200 bg-white p-6 text-center shadow-xl">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-orange-100">
                <RotateCcw className="h-5 w-5 text-orange-600" />
              </div>
              <h2 className="text-lg font-semibold tracking-tight">
                {loseReason === "stuck" ? "Stuck" : "Off course"}
              </h2>
              <p className="mt-1 text-xs text-stone-500">
                {loseReason === "stuck"
                  ? "The rider stopped. Rethink your lines."
                  : "The rider flew off. Try a different route."}
              </p>
              <div className="mt-5">
                <button
                  onClick={reset}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-stone-800"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Try again
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
