"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Pencil,
  Zap,
  Eraser,
  Hand,
  Play,
  Pause,
  RotateCcw,
  Undo2,
  Trash2,
  Save,
  FolderOpen,
  Download,
  Upload,
  ZoomIn,
  ZoomOut,
  Maximize,
  Flag,
  Gauge,
  Snowflake,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Types & constants                                                   */
/* ------------------------------------------------------------------ */

type Vec = { x: number; y: number };
type LineType = "normal" | "boost";
type Line = { x1: number; y1: number; x2: number; y2: number; type: LineType };
type Rider = { x: number; y: number; vx: number; vy: number };
type Tool = "draw" | "boost" | "erase" | "pan";

const GRAVITY = 0.16; // px / substep^2
const SUBSTEPS = 8; // physics substeps per rendered frame
const RADIUS = 4; // rider collision radius (px)
const FRICTION = 0.999; // per-substep friction while sliding
const BOOST = 0.32; // acceleration added per substep on a boost line
const MAX_SPEED = 3.4; // px / substep (kept below RADIUS to avoid tunneling)
const GRID = 50; // world grid spacing (px)

const STORAGE_KEY = "line-glide-track-v1";

const COLORS = {
  bg: "#faf7f2",
  gridMinor: "#ece5da",
  gridMajor: "#ddd3c3",
  line: "#27272a",
  boost: "#f97316",
  boostGlow: "rgba(249,115,22,0.35)",
  sled: "#b91c1c",
  head: "#fbbf24",
  body: "#1f2937",
  start: "#16a34a",
  trail: "rgba(185,28,28,0.35)",
};

/* ------------------------------------------------------------------ */
/* Math helpers                                                        */
/* ------------------------------------------------------------------ */

function closestPointOnSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { x: number; y: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { x: x1 + t * dx, y: y1 + t * dy };
}

function distToSegment(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const c = closestPointOnSegment(px, py, x1, y1, x2, y2);
  return Math.hypot(px - c.x, py - c.y);
}

function resolveCollision(rider: Rider, line: Line): boolean {
  const cp = closestPointOnSegment(
    rider.x,
    rider.y,
    line.x1,
    line.y1,
    line.x2,
    line.y2,
  );
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
    // Rider sits exactly on the line: use the line's perpendicular.
    const lx = line.x2 - line.x1;
    const ly = line.y2 - line.y1;
    const ll = Math.hypot(lx, ly) || 1;
    nx = -ly / ll;
    ny = lx / ll;
    dist = 0;
  }

  // Remove the velocity component directed into the surface.
  const vdotn = rider.vx * nx + rider.vy * ny;
  if (vdotn < 0) {
    rider.vx -= nx * vdotn;
    rider.vy -= ny * vdotn;
  }

  // Project velocity onto the line direction and apply friction.
  const lx = line.x2 - line.x1;
  const ly = line.y2 - line.y1;
  const ll = Math.hypot(lx, ly) || 1;
  const dirx = lx / ll;
  const diry = ly / ll;
  let valong = rider.vx * dirx + rider.vy * diry;
  valong *= FRICTION;
  rider.vx = dirx * valong;
  rider.vy = diry * valong;

  // Push the rider back to the surface.
  rider.x = cp.x + nx * RADIUS;
  rider.y = cp.y + ny * RADIUS;

  // Boost lines accelerate the rider along their direction.
  if (line.type === "boost") {
    rider.vx += dirx * BOOST;
    rider.vy += diry * BOOST;
  }
  return true;
}

function clampSpeed(rider: Rider) {
  const s = Math.hypot(rider.vx, rider.vy);
  if (s > MAX_SPEED) {
    const k = MAX_SPEED / s;
    rider.vx *= k;
    rider.vy *= k;
  }
}

function makeDefaultLines(): Line[] {
  return [
    { x1: 120, y1: 320, x2: 540, y2: 470, type: "normal" }, // main downhill
    { x1: 350, y1: 386, x2: 470, y2: 442, type: "boost" }, // boost mid-slope
    { x1: 540, y1: 470, x2: 680, y2: 404, type: "normal" }, // jump ramp up
    { x1: 820, y1: 540, x2: 1080, y2: 612, type: "normal" }, // landing slope
    { x1: 1080, y1: 612, x2: 1240, y2: 560, type: "boost" }, // boost out
  ];
}

/* ------------------------------------------------------------------ */
/* Drawing primitives (pure, module scope)                            */
/* ------------------------------------------------------------------ */

function drawGrid(
  ctx: CanvasRenderingContext2D,
  cam: Vec & { zoom: number },
  vw: number,
  vh: number,
  zoom: number,
) {
  const left = cam.x;
  const top = cam.y;
  const right = cam.x + vw / zoom;
  const bottom = cam.y + vh / zoom;
  const step = GRID;
  const minorEvery = 5;
  ctx.lineWidth = 1 / zoom;
  const x0 = Math.floor(left / step) * step;
  const y0 = Math.floor(top / step) * step;
  for (let x = x0; x <= right; x += step) {
    const major = Math.round(x / step) % minorEvery === 0;
    ctx.strokeStyle = major ? COLORS.gridMajor : COLORS.gridMinor;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
  }
  for (let y = y0; y <= bottom; y += step) {
    const major = Math.round(y / step) % minorEvery === 0;
    ctx.strokeStyle = major ? COLORS.gridMajor : COLORS.gridMinor;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
  }
  // Origin axes for orientation.
  ctx.strokeStyle = "rgba(220,90,60,0.25)";
  ctx.lineWidth = 1.5 / zoom;
  ctx.beginPath();
  ctx.moveTo(0, top);
  ctx.lineTo(0, bottom);
  ctx.moveTo(left, 0);
  ctx.lineTo(right, 0);
  ctx.stroke();
}

function drawLine(ctx: CanvasRenderingContext2D, l: Line) {
  ctx.lineCap = "round";
  if (l.type === "boost") {
    ctx.strokeStyle = COLORS.boostGlow;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(l.x1, l.y1);
    ctx.lineTo(l.x2, l.y2);
    ctx.stroke();
    ctx.strokeStyle = COLORS.boost;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(l.x1, l.y1);
    ctx.lineTo(l.x2, l.y2);
    ctx.stroke();
  } else {
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(l.x1, l.y1);
    ctx.lineTo(l.x2, l.y2);
    ctx.stroke();
  }
}

function drawStart(ctx: CanvasRenderingContext2D, p: Vec, zoom: number) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(1 / zoom, 1 / zoom); // keep flag a constant screen size
  ctx.fillStyle = COLORS.start;
  ctx.strokeStyle = "#14532d";
  ctx.lineWidth = 1.5;
  // pole
  ctx.beginPath();
  ctx.moveTo(0, -2);
  ctx.lineTo(0, 18);
  ctx.stroke();
  // flag
  ctx.beginPath();
  ctx.moveTo(0, -2);
  ctx.lineTo(16, 3);
  ctx.lineTo(0, 9);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawRider(ctx: CanvasRenderingContext2D, r: Rider, zoom: number) {
  const angle = Math.atan2(r.vy, r.vx);
  ctx.save();
  ctx.translate(r.x, r.y);
  ctx.scale(1 / zoom, 1 / zoom); // constant screen size character
  ctx.rotate(angle);
  // Sled
  ctx.strokeStyle = COLORS.sled;
  ctx.lineCap = "round";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-9, 3);
  ctx.lineTo(9, 3);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(9, 3);
  ctx.lineTo(11, 1); // tip up
  ctx.stroke();
  // Body
  ctx.strokeStyle = COLORS.body;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(1, 3);
  ctx.lineTo(-1, -7);
  ctx.stroke();
  // Head
  ctx.fillStyle = COLORS.head;
  ctx.strokeStyle = COLORS.body;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(-2, -9, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

type GameState = {
  lines: Line[];
  rider: Rider;
  start: Vec;
  camera: Vec & { zoom: number };
  // input / drawing
  pointerDown: boolean;
  pointerButton: number;
  dragStart: Vec | null; // screen coords
  dragCurrent: Vec | null; // screen coords
  drawingLine: (Line & { live: boolean }) | null;
  panning: boolean;
  panLast: Vec | null;
  draggingStart: boolean;
  spaceDown: boolean;
  // history (for undo)
  history: Line[][];
  // misc
  trail: Vec[];
  uiTick: number;
};

export default function LineRiderGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const gameRef = useRef<GameState>({
    lines: makeDefaultLines(),
    rider: { x: 200, y: 342, vx: 0, vy: 0 },
    start: { x: 200, y: 342 },
    camera: { x: 0, y: 0, zoom: 1 },
    pointerDown: false,
    pointerButton: 0,
    dragStart: null,
    dragCurrent: null,
    drawingLine: null,
    panning: false,
    panLast: null,
    draggingStart: false,
    spaceDown: false,
    history: [],
    trail: [],
    uiTick: 0,
  });

  // UI-facing state (kept separate from the hot loop).
  const [isPlaying, setIsPlaying] = useState(false);
  const [tool, setTool] = useState<Tool>("draw");
  const [speed, setSpeed] = useState(0);
  const [lineCount, setLineCount] = useState(0);
  const [zoomPct, setZoomPct] = useState(100);
  const [saved, setSaved] = useState(false);

  // Mirror UI state into refs so the RAF loop reads current values.
  const isPlayingRef = useRef(isPlaying);
  const toolRef = useRef(tool);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    toolRef.current = tool;
  }, [tool]);

  // Action refs let the keydown handler (registered once) call the
  // latest versions of these callbacks without re-subscribing listeners.
  const togglePlayRef = useRef<() => void>(() => {});
  const resetRef = useRef<() => void>(() => {});
  const undoRef = useRef<() => void>(() => {});

  /* ---------------------------------------------------------------- */
  /* Coordinate helpers (depend on canvas + camera)                   */
  /* ---------------------------------------------------------------- */

  const screenToWorld = useCallback((sx: number, sy: number): Vec => {
    const canvas = canvasRef.current!;
    const g = gameRef.current;
    return {
      x: g.camera.x + sx / g.camera.zoom,
      y: g.camera.y + sy / g.camera.zoom,
    };
  }, []);

  /* ---------------------------------------------------------------- */
  /* Setup effect (runs once)                                         */
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
      // Only update the drawing buffer; CSS (absolute inset-0) handles the
      // display size so we never create a measure→grow feedback loop.
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    // Centre the camera on the start position once we know the size.
    const initRect = container.getBoundingClientRect();
    const g0 = gameRef.current;
    g0.camera.x = g0.start.x - initRect.width / 2 / g0.camera.zoom;
    g0.camera.y = g0.start.y - initRect.height / 2 / g0.camera.zoom;
    setLineCount(g0.lines.length);

    /* ------------------ input handlers ------------------ */

    const getPos = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const pos = getPos(e);
      const g = gameRef.current;
      g.pointerDown = true;
      g.pointerButton = e.button;

      // Right-click always erases the nearest line (quick erase).
      if (e.button === 2) {
        eraseAt(pos);
        return;
      }
      // Middle-click or space-held always pans.
      if (e.button === 1 || g.spaceDown) {
        g.panning = true;
        g.panLast = pos;
        return;
      }

      const world = screenToWorld(pos.x, pos.y);

      // Drag the start flag in edit mode (priority over tools).
      if (!isPlayingRef.current && Math.hypot(world.x - g.start.x, world.y - g.start.y) < 16 / g.camera.zoom) {
        g.draggingStart = true;
        return;
      }

      const activeTool = toolRef.current;
      if (activeTool === "pan") {
        g.panning = true;
        g.panLast = pos;
      } else if (activeTool === "erase") {
        eraseAt(pos);
      } else if (activeTool === "draw" || activeTool === "boost") {
        g.dragStart = pos;
        g.dragCurrent = pos;
        g.drawingLine = {
          x1: world.x,
          y1: world.y,
          x2: world.x,
          y2: world.y,
          type: activeTool === "boost" ? "boost" : "normal",
          live: true,
        };
      }
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

      if (g.draggingStart) {
        const world = screenToWorld(pos.x, pos.y);
        g.start = world;
        if (!isPlayingRef.current) {
          g.rider.x = world.x;
          g.rider.y = world.y;
          g.rider.vx = 0;
          g.rider.vy = 0;
          g.trail = [];
        }
        return;
      }

      if (g.drawingLine) {
        g.dragCurrent = pos;
        const world = screenToWorld(pos.x, pos.y);
        g.drawingLine.x2 = world.x;
        g.drawingLine.y2 = world.y;
      }
    };

    const finishPointer = (e: PointerEvent) => {
      const g = gameRef.current;
      if (g.drawingLine) {
        const len = Math.hypot(
          g.drawingLine.x2 - g.drawingLine.x1,
          g.drawingLine.y2 - g.drawingLine.y1,
        );
        if (len > 6) {
          pushHistory();
          g.lines.push({
            x1: g.drawingLine.x1,
            y1: g.drawingLine.y1,
            x2: g.drawingLine.x2,
            y2: g.drawingLine.y2,
            type: g.drawingLine.type,
          });
          setLineCount(g.lines.length);
        }
      }
      g.drawingLine = null;
      g.dragStart = null;
      g.dragCurrent = null;
      g.panning = false;
      g.panLast = null;
      g.draggingStart = false;
      g.pointerDown = false;
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
      setZoomPct(Math.round(g.camera.zoom * 100));
    };

    const onContextMenu = (e: Event) => e.preventDefault();

    const onKeyDown = (e: KeyboardEvent) => {
      const g = gameRef.current;
      if (e.code === "Space") {
        g.spaceDown = true;
        if (!e.repeat) {
          e.preventDefault();
          togglePlayRef.current();
        }
      } else if (e.key === "r" || e.key === "R") {
        resetRef.current();
      } else if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        undoRef.current();
      } else if (e.key === "1") setTool("draw");
      else if (e.key === "2") setTool("boost");
      else if (e.key === "3") setTool("erase");
      else if (e.key === "4") setTool("pan");
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") gameRef.current.spaceDown = false;
    };

    const eraseAt = (pos: Vec) => {
      const g = gameRef.current;
      const world = screenToWorld(pos.x, pos.y);
      const threshold = 10 / g.camera.zoom;
      let bestIdx = -1;
      let bestDist = threshold;
      for (let i = 0; i < g.lines.length; i++) {
        const l = g.lines[i];
        const d = distToSegment(world.x, world.y, l.x1, l.y1, l.x2, l.y2);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) {
        pushHistory();
        g.lines.splice(bestIdx, 1);
        setLineCount(g.lines.length);
      }
    };

    /* ------------------ history & actions ------------------ */

    const pushHistory = () => {
      const g = gameRef.current;
      g.history.push(g.lines.map((l) => ({ ...l })));
      if (g.history.length > 60) g.history.shift();
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    /* ------------------ render + physics loop ------------------ */

    const render = () => {
      const g = gameRef.current;
      const w = canvas.width;
      const h = canvas.height;
      const zoom = g.camera.zoom;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, w / dpr, h / dpr);

      // World transform.
      ctx.save();
      ctx.scale(zoom, zoom);
      ctx.translate(-g.camera.x, -g.camera.y);

      drawGrid(ctx, g.camera, w / dpr, h / dpr, zoom);

      // Lines.
      for (const l of g.lines) {
        drawLine(ctx, l);
      }

      // Live drawing preview.
      if (g.drawingLine) {
        const dl = g.drawingLine;
        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 2 / zoom;
        if (dl.type === "boost") {
          ctx.strokeStyle = COLORS.boost;
        } else {
          ctx.strokeStyle = COLORS.line;
        }
        ctx.setLineDash([6 / zoom, 4 / zoom]);
        ctx.beginPath();
        ctx.moveTo(dl.x1, dl.y1);
        ctx.lineTo(dl.x2, dl.y2);
        ctx.stroke();
        ctx.restore();
      }

      // Start marker.
      drawStart(ctx, g.start, zoom);

      // Trail.
      if (g.trail.length > 1) {
        ctx.strokeStyle = COLORS.trail;
        ctx.lineWidth = 2 / zoom;
        ctx.beginPath();
        ctx.moveTo(g.trail[0].x, g.trail[0].y);
        for (let i = 1; i < g.trail.length; i++) {
          ctx.lineTo(g.trail[i].x, g.trail[i].y);
        }
        ctx.stroke();
      }

      // Rider.
      drawRider(ctx, g.rider, zoom);

      ctx.restore();

      // HUD: edit/play badge.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = "600 12px var(--font-geist-sans), system-ui, sans-serif";
      ctx.textBaseline = "top";
      const badge = isPlayingRef.current ? "● PLAYING" : "✎ EDIT";
      ctx.fillStyle = isPlayingRef.current ? COLORS.boost : "#9a8f7d";
      ctx.fillText(badge, 12, 12);
    };

    const step = () => {
      const g = gameRef.current;
      if (!isPlayingRef.current) return;
      const r = g.rider;
      for (let s = 0; s < SUBSTEPS; s++) {
        r.vy += GRAVITY;
        clampSpeed(r);
        r.x += r.vx;
        r.y += r.vy;
        for (const l of g.lines) {
          resolveCollision(r, l);
        }
        clampSpeed(r);
      }
      // Trail (sampled once per frame).
      g.trail.push({ x: r.x, y: r.y });
      if (g.trail.length > 40) g.trail.shift();

      // Camera follow with smoothing.
      const rect = container.getBoundingClientRect();
      const targetX = r.x - rect.width / 2 / g.camera.zoom;
      const targetY = r.y - rect.height / 2 / g.camera.zoom;
      g.camera.x += (targetX - g.camera.x) * 0.12;
      g.camera.y += (targetY - g.camera.y) * 0.12;

      // Throttled UI updates.
      g.uiTick++;
      if (g.uiTick % 4 === 0) {
        const s = Math.hypot(r.vx, r.vy);
        setSpeed(Math.round(s * 230));
      }
    };

    const loop = () => {
      step();
      render();
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
  }, []);

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */

  const pushHistory = () => {
    const g = gameRef.current;
    g.history.push(g.lines.map((l) => ({ ...l })));
    if (g.history.length > 60) g.history.shift();
  };

  const togglePlay = useCallback(() => {
    setIsPlaying((prev) => {
      const next = !prev;
      if (next) {
        // Starting play: ensure rider is at start with zero velocity.
        const g = gameRef.current;
        g.rider.x = g.start.x;
        g.rider.y = g.start.y;
        g.rider.vx = 0;
        g.rider.vy = 0;
        g.trail = [];
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    const g = gameRef.current;
    g.rider.x = g.start.x;
    g.rider.y = g.start.y;
    g.rider.vx = 0;
    g.rider.vy = 0;
    g.trail = [];
    setSpeed(0);
  }, []);

  const undo = useCallback(() => {
    const g = gameRef.current;
    const prev = g.history.pop();
    if (prev) {
      g.lines = prev;
      setLineCount(g.lines.length);
    } else {
      // If no history, undo the last line directly.
      if (g.lines.length > 0) {
        g.lines.pop();
        setLineCount(g.lines.length);
      }
    }
  }, []);

  // Keep the keydown handler's action refs in sync with the latest callbacks.
  useEffect(() => {
    togglePlayRef.current = togglePlay;
    resetRef.current = reset;
    undoRef.current = undo;
  }, [togglePlay, reset, undo]);

  const clearAll = useCallback(() => {
    const g = gameRef.current;
    pushHistory();
    g.lines = [];
    setLineCount(0);
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const g = gameRef.current;
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const before = screenToWorld(cx, cy);
    g.camera.zoom = Math.max(0.2, Math.min(4, g.camera.zoom * factor));
    const after = screenToWorld(cx, cy);
    g.camera.x += before.x - after.x;
    g.camera.y += before.y - after.y;
    setZoomPct(Math.round(g.camera.zoom * 100));
  }, [screenToWorld]);

  const fitView = useCallback(() => {
    const g = gameRef.current;
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const pts = [g.start, ...g.lines.flatMap((l) => [{ x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 }])];
    if (pts.length === 0) return;
    const minX = Math.min(...pts.map((p) => p.x));
    const maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    const maxY = Math.max(...pts.map((p) => p.y));
    const pad = 80;
    const bw = maxX - minX + pad * 2;
    const bh = maxY - minY + pad * 2;
    const zoom = Math.max(0.2, Math.min(2, Math.min(rect.width / bw, rect.height / bh)));
    g.camera.zoom = zoom;
    g.camera.x = (minX + maxX) / 2 - rect.width / 2 / zoom;
    g.camera.y = (minY + maxY) / 2 - rect.height / 2 / zoom;
    setZoomPct(Math.round(zoom * 100));
  }, []);

  const saveTrack = useCallback(() => {
    const g = gameRef.current;
    const data = {
      version: 1,
      start: g.start,
      lines: g.lines,
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    } catch {
      /* ignore */
    }
  }, []);

  const loadTrack = useCallback(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as { start: Vec; lines: Line[] };
      const g = gameRef.current;
      g.lines = data.lines ?? [];
      g.start = data.start ?? g.start;
      g.rider.x = g.start.x;
      g.rider.y = g.start.y;
      g.rider.vx = 0;
      g.rider.vy = 0;
      g.trail = [];
      setLineCount(g.lines.length);
      fitView();
    } catch {
      /* ignore */
    }
  }, [fitView]);

  const exportTrack = useCallback(() => {
    const g = gameRef.current;
    const data = JSON.stringify({ version: 1, start: g.start, lines: g.lines }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "line-glide-track.json";
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const importTrack = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result)) as { start: Vec; lines: Line[] };
          const g = gameRef.current;
          g.lines = data.lines ?? [];
          g.start = data.start ?? g.start;
          g.rider.x = g.start.x;
          g.rider.y = g.start.y;
          g.rider.vx = 0;
          g.rider.vy = 0;
          g.trail = [];
          setLineCount(g.lines.length);
          fitView();
        } catch {
          /* ignore */
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [fitView]);

  /* ---------------------------------------------------------------- */
  /* Render                                                            */
  /* ---------------------------------------------------------------- */

  const tools: { id: Tool; label: string; icon: React.ReactNode; hint: string }[] = [
    { id: "draw", label: "Line", icon: <Pencil className="h-4 w-4" />, hint: "Draw a solid line (1)" },
    { id: "boost", label: "Boost", icon: <Zap className="h-4 w-4" />, hint: "Draw an acceleration line (2)" },
    { id: "erase", label: "Erase", icon: <Eraser className="h-4 w-4" />, hint: "Click a line to erase (3)" },
    { id: "pan", label: "Pan", icon: <Hand className="h-4 w-4" />, hint: "Drag to pan the view (4)" },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#faf7f2] text-zinc-900">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-red-600 text-white shadow-sm">
              <Snowflake className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold leading-none tracking-tight">
                Line Glide
              </h1>
              <p className="text-xs text-zinc-500">
                Draw lines, hit play, watch the rider fly.
              </p>
            </div>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <Stat icon={<Gauge className="h-3.5 w-3.5" />} label="Speed" value={String(speed)} />
            <Stat icon={<Pencil className="h-3.5 w-3.5" />} label="Lines" value={String(lineCount)} />
            <Stat icon={<Maximize className="h-3.5 w-3.5" />} label="Zoom" value={`${zoomPct}%`} />
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex flex-1 flex-col gap-3 p-3 sm:p-4">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white p-2 shadow-sm">
          <TooltipProvider delayDuration={300}>
            {/* Play / Pause */}
            <Button
              size="sm"
              onClick={togglePlay}
              className={
                isPlaying
                  ? "bg-zinc-800 hover:bg-zinc-700 text-white"
                  : "bg-orange-500 hover:bg-orange-600 text-white"
              }
            >
              {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {isPlaying ? "Pause" : "Play"}
            </Button>
            <Button size="sm" variant="outline" onClick={reset}>
              <RotateCcw className="h-4 w-4" />
              <span className="hidden sm:inline">Reset</span>
            </Button>

            <div className="mx-1 h-6 w-px bg-zinc-200" />

            {/* Tools */}
            {tools.map((t) => (
              <Tooltip key={t.id}>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant={tool === t.id ? "default" : "outline"}
                    onClick={() => setTool(t.id)}
                    className={
                      tool === t.id
                        ? t.id === "boost"
                          ? "bg-orange-500 hover:bg-orange-600 text-white"
                          : "bg-zinc-800 hover:bg-zinc-700 text-white"
                        : ""
                    }
                  >
                    {t.icon}
                    <span className="hidden md:inline">{t.label}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t.hint}</TooltipContent>
              </Tooltip>
            ))}

            <div className="mx-1 h-6 w-px bg-zinc-200" />

            <Button size="sm" variant="outline" onClick={undo}>
              <Undo2 className="h-4 w-4" />
              <span className="hidden md:inline">Undo</span>
            </Button>
            <Button size="sm" variant="outline" onClick={clearAll}>
              <Trash2 className="h-4 w-4" />
              <span className="hidden md:inline">Clear</span>
            </Button>

            <div className="mx-1 h-6 w-px bg-zinc-200" />

            <Button size="sm" variant="outline" onClick={saveTrack}>
              <Save className="h-4 w-4" />
              <span className="hidden lg:inline">{saved ? "Saved!" : "Save"}</span>
            </Button>
            <Button size="sm" variant="outline" onClick={loadTrack}>
              <FolderOpen className="h-4 w-4" />
              <span className="hidden lg:inline">Load</span>
            </Button>
            <Button size="sm" variant="outline" onClick={exportTrack}>
              <Download className="h-4 w-4" />
              <span className="hidden lg:inline">Export</span>
            </Button>
            <Button size="sm" variant="outline" onClick={importTrack}>
              <Upload className="h-4 w-4" />
              <span className="hidden lg:inline">Import</span>
            </Button>

            <div className="ml-auto flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => zoomBy(1 / 1.2)}>
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="w-12 text-center text-xs font-medium tabular-nums text-zinc-600">
                {zoomPct}%
              </span>
              <Button size="sm" variant="ghost" onClick={() => zoomBy(1.2)}>
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={fitView}>
                <Maximize className="h-4 w-4" />
              </Button>
            </div>
          </TooltipProvider>
        </div>

        {/* Canvas */}
        <div
          ref={containerRef}
          className="relative flex-1 overflow-hidden rounded-xl border border-zinc-200 bg-[#faf7f2] shadow-inner min-h-0"
        >
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full touch-none select-none"
          />
          {/* Hint overlay */}
          <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-white/85 px-3 py-2 text-[11px] leading-relaxed text-zinc-600 shadow-sm backdrop-blur">
            <span className="font-semibold text-zinc-800">Tips:</span> drag to draw ·{" "}
            <kbd className="rounded bg-zinc-100 px-1">Space</kbd> play/pause ·{" "}
            <kbd className="rounded bg-zinc-100 px-1">R</kbd> reset ·{" "}
            <kbd className="rounded bg-zinc-100 px-1">Ctrl+Z</kbd> undo · right-click
            erases · scroll to zoom · drag the green flag to set start.
          </div>
        </div>
      </main>

      {/* Footer (sticky to bottom) */}
      <footer className="mt-auto border-t border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-[1400px] flex-col items-center justify-between gap-1 px-4 py-3 text-xs text-zinc-500 sm:flex-row">
          <p className="flex items-center gap-1.5">
            <Flag className="h-3.5 w-3.5 text-green-600" />
            Line Glide — a Line Rider–style physics sandbox.
          </p>
          <p>Built with Next.js, Canvas & a hand-rolled physics loop.</p>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small presentational helper                                         */
/* ------------------------------------------------------------------ */

function Stat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5">
      <span className="text-zinc-400">{icon}</span>
      <span className="text-zinc-400">{label}</span>
      <span className="font-semibold tabular-nums text-zinc-800">{value}</span>
    </div>
  );
}
