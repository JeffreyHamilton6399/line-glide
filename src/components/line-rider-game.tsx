"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
} from "lucide-react";
import { LEVELS, type GameLine, type Level, type LineType, type Vec } from "@/lib/levels";

/* ------------------------------------------------------------------ */
/* Physics constants                                                   */
/* ------------------------------------------------------------------ */

// Tuned for a gentle, realistic sled feel: light gravity so it never
// drops too fast, modest snow drag (glides on slopes, settles on flats),
// and a low top speed so motion stays readable.
const GRAVITY = 0.03;
const SUBSTEPS = 6;
const RADIUS = 4;
const FRICTION = 0.99; // per-substep kinetic drag
const BOOST = 0.18; // push along a boost line's direction
const MAX_SPEED = 1.7; // well under RADIUS/substep → no tunneling
const STUCK_FRAMES = 180; // ~3s of being nearly stopped → "stuck"
const STUCK_SPEED = 0.04; // below this counts as stopped
const STUCK_GRACE = 40; // first ~0.7s of a run is never counted as stuck

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
  trail: "rgba(185,28,28,0.25)",
  fixed: "#44403c",
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
  const cp = closestPointOnSegment(rider.x, rider.y, line.x1, line.y1, line.x2, line.y2);
  let dx = rider.x - cp.x;
  let dy = rider.y - cp.y;
  let dist = Math.hypot(dx, dy);
  if (dist >= RADIUS) return false;

  let nx: number;
  let ny: number;
  if (dist > 0.0001) {
    nx = dx / dist;
    ny = dy / dist;
  } else {
    const lx = line.x2 - line.x1;
    const ly = line.y2 - line.y1;
    const ll = Math.hypot(lx, ly) || 1;
    nx = -ly / ll;
    ny = lx / ll;
    dist = 0;
  }

  const vdotn = rider.vx * nx + rider.vy * ny;
  if (vdotn < 0) {
    rider.vx -= nx * vdotn;
    rider.vy -= ny * vdotn;
  }

  const lx = line.x2 - line.x1;
  const ly = line.y2 - line.y1;
  const ll = Math.hypot(lx, ly) || 1;
  const dirx = lx / ll;
  const diry = ly / ll;
  let valong = rider.vx * dirx + rider.vy * diry;
  valong *= FRICTION;
  rider.vx = dirx * valong;
  rider.vy = diry * valong;

  rider.x = cp.x + nx * RADIUS;
  rider.y = cp.y + ny * RADIUS;

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

function drawRider(ctx: CanvasRenderingContext2D, r: { x: number; y: number; angle: number }, zoom: number) {
  // Angle is smoothed in the physics step so the sled doesn't jitter
  // when nearly stationary.
  const angle = r.angle;
  const s = 1.2;
  ctx.save();
  ctx.translate(r.x, r.y);
  ctx.scale((s) / zoom, (s) / zoom);
  ctx.rotate(angle);
  // sled
  ctx.strokeStyle = PALETTE.sled;
  ctx.lineCap = "round";
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(-10, 3);
  ctx.lineTo(10, 3);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(10, 3);
  ctx.lineTo(12, 1);
  ctx.stroke();
  // body
  ctx.strokeStyle = PALETTE.body;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(1, 3);
  ctx.lineTo(-1, -8);
  ctx.stroke();
  // head
  ctx.fillStyle = PALETTE.head;
  ctx.strokeStyle = PALETTE.body;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(-2, -10, 3.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Game state                                                          */
/* ------------------------------------------------------------------ */

type Phase = "editing" | "playing" | "won" | "lost";
type Tool = "line" | "boost" | "erase";
type LoseReason = "stuck" | "offcourse";

type GameState = {
  level: Level;
  playerLines: GameLine[];
  rider: { x: number; y: number; vx: number; vy: number; angle: number };
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
  const [usedBudget, setUsedBudget] = useState(0);
  const [loseReason, setLoseReason] = useState<LoseReason>("stuck");
  const [completed, setCompleted] = useState<number[]>(() => loadProgress());
  const [showHelp, setShowHelp] = useState(false);

  const level = LEVELS[levelIndex];

  const gameRef = useRef<GameState>({
    level: LEVELS[0],
    playerLines: [],
    rider: { x: LEVELS[0].start.x, y: LEVELS[0].start.y, vx: 0, vy: 0, angle: 0 },
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
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

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
      g.rider = { x: lvl.start.x, y: lvl.start.y, vx: 0, vy: 0, angle: 0 };
      g.history = [];
      g.trail = [];
      g.stuckFrames = 0;
      g.drawingPath = null;
      g.panning = false;
      setLevelIndex(idx);
      setPhase("editing");
      setUsedBudget(0);
      const id = requestAnimationFrame(() => fitToLevel(lvl));
      return () => cancelAnimationFrame(id);
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
    g.rider = { x: g.level.start.x, y: g.level.start.y, vx: 0, vy: 0, angle: 0 };
    g.trail = [];
    // Negative grace so the launch (rider briefly stationary) isn't
    // mistaken for being stuck.
    g.stuckFrames = -STUCK_GRACE;
    setPhase("playing");
  }, []);

  const reset = useCallback(() => {
    const g = gameRef.current;
    g.rider = { x: g.level.start.x, y: g.level.start.y, vx: 0, vy: 0, angle: 0 };
    g.trail = [];
    g.stuckFrames = 0;
    setPhase("editing");
  }, []);

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
        type: activeTool === "boost" ? "boost" : "normal",
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

      // Lose — off course (generous, but not infinite).
      const offX = r.x < lvl.start.x - 700 || r.x > lvl.goal.x + 900;
      const offY = r.y > lvl.goal.y + 700 || r.y < lvl.start.y - 700;
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
        ctx.save();
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = 2 / zoom;
        ctx.strokeStyle = g.drawingPath.type === "boost" ? PALETTE.boost : PALETTE.ink;
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

    const loop = (t: number) => {
      step();
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

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  return (
    <div className="flex h-screen flex-col bg-[#f5f2ec] text-stone-900 overflow-hidden">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-stone-200/70 px-3 sm:px-4">
        {/* Level nav */}
        <div className="flex items-center gap-1">
          <button
            onClick={prevLevel}
            disabled={levelIndex === 0 || phase === "playing"}
            className="flex h-8 w-8 items-center justify-center rounded-md text-stone-500 transition hover:bg-stone-200/60 hover:text-stone-900 disabled:opacity-30 disabled:hover:bg-transparent"
            aria-label="Previous level"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="font-mono text-sm tabular-nums text-stone-400">
              {String(level.id).padStart(2, "0")}
            </span>
            <span className="truncate text-sm font-medium tracking-tight">
              {level.name}
            </span>
            {completed.includes(level.id) && (
              <Check className="h-3.5 w-3.5 text-green-600" />
            )}
          </div>
          <button
            onClick={nextLevel}
            disabled={isLastLevel || phase === "playing"}
            className="flex h-8 w-8 items-center justify-center rounded-md text-stone-500 transition hover:bg-stone-200/60 hover:text-stone-900 disabled:opacity-30 disabled:hover:bg-transparent"
            aria-label="Next level"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1" />

        {/* Budget */}
        <div className="hidden items-center gap-2 sm:flex">
          <span className="text-[11px] font-medium uppercase tracking-wider text-stone-400">
            Track
          </span>
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-stone-200 lg:w-32">
            <div
              className={`h-full rounded-full transition-all duration-200 ${
                budgetLow ? "bg-orange-600" : "bg-stone-800"
              }`}
              style={{ width: `${budgetPct}%` }}
            />
          </div>
          <span className="w-16 text-right font-mono text-xs tabular-nums text-stone-500">
            {usedBudget}/{level.budget}
          </span>
        </div>

        {/* Tool segmented control */}
        <div className="flex items-center gap-0.5 rounded-lg border border-stone-200 bg-white/60 p-0.5">
          {(["line", "boost", "erase"] as Tool[]).map((t) => (
            <button
              key={t}
              onClick={() => setTool(t)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition sm:px-3 ${
                tool === t
                  ? t === "boost"
                    ? "bg-orange-600 text-white"
                    : "bg-stone-900 text-white"
                  : "text-stone-500 hover:text-stone-900"
              }`}
            >
              <span className="hidden sm:inline">{t}</span>
              <span className="sm:hidden">{t === "line" ? "∕" : t === "boost" ? "⚡" : "⌫"}</span>
            </button>
          ))}
        </div>

        {/* Undo / Clear */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={undo}
            disabled={phase === "playing"}
            className="flex h-8 w-8 items-center justify-center rounded-md text-stone-500 transition hover:bg-stone-200/60 hover:text-stone-900 disabled:opacity-30"
            aria-label="Undo"
          >
            <Undo2 className="h-4 w-4" />
          </button>
          <button
            onClick={clearAll}
            disabled={phase === "playing"}
            className="flex h-8 w-8 items-center justify-center rounded-md text-stone-500 transition hover:bg-stone-200/60 hover:text-stone-900 disabled:opacity-30"
            aria-label="Clear"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        {/* Play / Reset */}
        <Button
          onClick={onPlayClick}
          size="sm"
          className={`ml-1 h-8 gap-1.5 px-4 ${
            phase === "playing"
              ? "bg-stone-700 hover:bg-stone-600"
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
        </Button>
      </header>

      {/* Canvas stage */}
      <main ref={containerRef} className="relative min-h-0 flex-1">
        <canvas className="absolute inset-0 h-full w-full touch-none select-none" ref={canvasRef} />

        {/* Mobile budget bar */}
        <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full border border-stone-200/70 bg-white/80 px-3 py-1.5 backdrop-blur sm:hidden">
          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-stone-200">
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
          <div className="pointer-events-none absolute bottom-3 left-3 max-w-xs rounded-lg bg-white/70 px-3 py-1.5 text-xs text-stone-500 backdrop-blur">
            {level.hint}
          </div>
        )}

        {/* Help */}
        <button
          onClick={() => setShowHelp((s) => !s)}
          className="absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-full border border-stone-200/70 bg-white/80 text-stone-500 backdrop-blur transition hover:text-stone-900"
          aria-label="Help"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
        {showHelp && (
          <div className="absolute bottom-14 right-3 w-60 rounded-xl border border-stone-200 bg-white p-4 text-xs text-stone-600 shadow-lg">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-stone-900">Controls</span>
              <button onClick={() => setShowHelp(false)} className="text-stone-400 hover:text-stone-900">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <ul className="space-y-1.5">
              <li><span className="font-mono text-stone-400">drag</span> — draw a line or curve</li>
              <li><span className="font-mono text-stone-400">right-click</span> — erase a line</li>
              <li><span className="font-mono text-stone-400">space + drag</span> — pan</li>
              <li><span className="font-mono text-stone-400">scroll</span> — zoom</li>
              <li><span className="font-mono text-stone-400">1 2 3</span> — line / boost / erase</li>
              <li><span className="font-mono text-stone-400">space</span> — run / stop</li>
              <li><span className="font-mono text-stone-400">R</span> — reset rider</li>
              <li><span className="font-mono text-stone-400">⌘Z</span> — undo</li>
            </ul>
            <p className="mt-3 border-t border-stone-100 pt-2 text-[11px] leading-relaxed text-stone-400">
              Orange lines boost you along their direction. Reach the gold flag before you run out of track.
            </p>
          </div>
        )}

        {/* Win overlay */}
        {phase === "won" && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#f5f2ec]/60 backdrop-blur-sm">
            <div className="w-72 rounded-2xl border border-stone-200 bg-white p-6 text-center shadow-xl">
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-green-100">
                <Check className="h-5 w-5 text-green-600" />
              </div>
              <h2 className="text-lg font-semibold tracking-tight">Level complete</h2>
              <p className="mt-1 text-xs text-stone-500">
                {isLastLevel ? "You finished every level." : `Track used: ${usedBudget} of ${level.budget}`}
              </p>
              <div className="mt-5 flex gap-2">
                <Button
                  onClick={reset}
                  variant="outline"
                  size="sm"
                  className="flex-1"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Replay
                </Button>
                {!isLastLevel ? (
                  <Button onClick={nextLevel} size="sm" className="flex-1 bg-stone-900 hover:bg-stone-800">
                    Next <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <Button
                    onClick={() => loadLevel(0)}
                    size="sm"
                    className="flex-1 bg-stone-900 hover:bg-stone-800"
                  >
                    Level 1
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Lose overlay */}
        {phase === "lost" && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#f5f2ec]/60 backdrop-blur-sm">
            <div className="w-72 rounded-2xl border border-stone-200 bg-white p-6 text-center shadow-xl">
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-orange-100">
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
              <div className="mt-5 flex gap-2">
                <Button onClick={reset} size="sm" className="flex-1 bg-stone-900 hover:bg-stone-800">
                  <RotateCcw className="h-3.5 w-3.5" /> Try again
                </Button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
