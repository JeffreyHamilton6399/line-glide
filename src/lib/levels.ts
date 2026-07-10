export type Vec = { x: number; y: number };

/** Line types:
 *  - normal:  solid track the rider collides with
 *  - boost:   accelerates the rider along its direction
 *  - slow:    high-friction track (rough/icy patch) that drains speed
 *  - scenery: decorative only — no collision (background art)
 */
export type LineType = "normal" | "boost" | "slow" | "scenery";

export type GameLine = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  type: LineType;
  /** Fixed lines are part of the level and cannot be erased by the player. */
  fixed?: boolean;
  /** Player strokes (freehand curves) share an id so the eraser removes the
   *  whole stroke, not a single tiny segment. */
  strokeId?: number;
};

export type Level = {
  id: number;
  name: string;
  start: Vec;
  goal: Vec;
  goalRadius: number;
  /** Maximum total length of player-drawn lines. */
  budget: number;
  /** Fixed obstacle lines (ledges, walls, bumpers). */
  lines: GameLine[];
  hint: string;
};

export const LEVELS: Level[] = [
  {
    id: 1,
    name: "First Drop",
    start: { x: 220, y: 200 },
    goal: { x: 1150, y: 680 },
    goalRadius: 44,
    budget: 1100,
    hint: "Draw a slope from the ledge down to the flag.",
    lines: [
      { x1: 165, y1: 225, x2: 300, y2: 265, type: "normal", fixed: true },
      { x1: 1030, y1: 720, x2: 1270, y2: 720, type: "normal", fixed: true },
    ],
  },
  {
    id: 2,
    name: "The Gap",
    start: { x: 200, y: 360 },
    goal: { x: 1200, y: 360 },
    goalRadius: 44,
    budget: 780,
    hint: "Cross the gap. Bridge it, or ramp and jump.",
    lines: [
      { x1: 150, y1: 385, x2: 335, y2: 415, type: "normal", fixed: true },
      { x1: 1080, y1: 400, x2: 1280, y2: 400, type: "normal", fixed: true },
    ],
  },
  {
    id: 3,
    name: "Boost Up",
    start: { x: 200, y: 700 },
    goal: { x: 1150, y: 180 },
    goalRadius: 46,
    budget: 880,
    hint: "Boost lines push you along their direction. Aim one up and right.",
    lines: [
      { x1: 150, y1: 720, x2: 325, y2: 760, type: "normal", fixed: true },
      { x1: 1040, y1: 220, x2: 1260, y2: 220, type: "normal", fixed: true },
      { x1: 540, y1: 540, x2: 760, y2: 580, type: "normal", fixed: true },
    ],
  },
  {
    id: 4,
    name: "Pinball",
    start: { x: 180, y: 150 },
    goal: { x: 1200, y: 760 },
    goalRadius: 44,
    budget: 620,
    hint: "Link the bumpers with short connector lines.",
    lines: [
      { x1: 130, y1: 175, x2: 265, y2: 205, type: "normal", fixed: true },
      { x1: 320, y1: 320, x2: 520, y2: 400, type: "normal", fixed: true },
      { x1: 720, y1: 500, x2: 920, y2: 420, type: "normal", fixed: true },
      { x1: 1000, y1: 620, x2: 1180, y2: 700, type: "normal", fixed: true },
      { x1: 1140, y1: 800, x2: 1260, y2: 800, type: "normal", fixed: true },
    ],
  },
  {
    id: 5,
    name: "Long Way",
    start: { x: 200, y: 180 },
    goal: { x: 2050, y: 820 },
    goalRadius: 52,
    budget: 2600,
    hint: "Open road. Build whatever path you like.",
    lines: [
      { x1: 150, y1: 205, x2: 295, y2: 235, type: "normal", fixed: true },
      { x1: 1950, y1: 860, x2: 2150, y2: 860, type: "normal", fixed: true },
      // distant scenery mountains (decorative, non-colliding)
      { x1: 600, y1: 860, x2: 900, y2: 520, type: "scenery", fixed: true },
      { x1: 900, y1: 520, x2: 1200, y2: 860, type: "scenery", fixed: true },
      { x1: 1300, y1: 860, x2: 1650, y2: 480, type: "scenery", fixed: true },
      { x1: 1650, y1: 480, x2: 1900, y2: 860, type: "scenery", fixed: true },
    ],
  },
  {
    id: 6,
    name: "Switchback",
    start: { x: 220, y: 180 },
    goal: { x: 1150, y: 760 },
    goalRadius: 46,
    budget: 1500,
    hint: "There's a wall in the way. Curve around it, or ramp over the top.",
    lines: [
      { x1: 165, y1: 205, x2: 300, y2: 245, type: "normal", fixed: true },
      { x1: 620, y1: 360, x2: 620, y2: 660, type: "normal", fixed: true },
      { x1: 1020, y1: 800, x2: 1270, y2: 800, type: "normal", fixed: true },
    ],
  },
  {
    id: 7,
    name: "Valley",
    start: { x: 200, y: 180 },
    goal: { x: 1200, y: 320 },
    goalRadius: 46,
    budget: 1600,
    hint: "Carve a bowl down and up to the far ledge. Curves work better than angles.",
    lines: [
      { x1: 150, y1: 205, x2: 320, y2: 235, type: "normal", fixed: true },
      { x1: 1080, y1: 345, x2: 1280, y2: 345, type: "normal", fixed: true },
    ],
  },
  {
    id: 8,
    name: "Bumpers",
    start: { x: 180, y: 160 },
    goal: { x: 1250, y: 760 },
    goalRadius: 44,
    budget: 1000,
    hint: "Link the fixed ramps with smooth curves. Watch the rough patch.",
    lines: [
      { x1: 130, y1: 175, x2: 270, y2: 205, type: "normal", fixed: true },
      { x1: 340, y1: 330, x2: 520, y2: 300, type: "normal", fixed: true },
      { x1: 640, y1: 460, x2: 820, y2: 430, type: "slow", fixed: true },
      { x1: 900, y1: 600, x2: 1080, y2: 630, type: "normal", fixed: true },
      { x1: 1140, y1: 800, x2: 1280, y2: 800, type: "normal", fixed: true },
    ],
  },
  {
    id: 9,
    name: "Free Run",
    start: { x: 200, y: 180 },
    goal: { x: 1950, y: 820 },
    goalRadius: 52,
    budget: 3400,
    hint: "Open canvas. Draw any path you can imagine — straight, curved, looped.",
    lines: [
      { x1: 150, y1: 205, x2: 295, y2: 235, type: "normal", fixed: true },
      { x1: 1860, y1: 860, x2: 2080, y2: 860, type: "normal", fixed: true },
    ],
  },
  {
    id: 10,
    name: "Hairpin",
    start: { x: 220, y: 180 },
    goal: { x: 1180, y: 760 },
    goalRadius: 46,
    budget: 1700,
    hint: "Two walls block the way. Weave an S-curve down and around them.",
    lines: [
      { x1: 165, y1: 205, x2: 300, y2: 245, type: "normal", fixed: true },
      { x1: 520, y1: 300, x2: 520, y2: 560, type: "normal", fixed: true },
      { x1: 820, y1: 500, x2: 820, y2: 760, type: "normal", fixed: true },
      { x1: 1050, y1: 800, x2: 1280, y2: 800, type: "normal", fixed: true },
    ],
  },
  {
    id: 11,
    name: "Long Jump",
    start: { x: 200, y: 180 },
    goal: { x: 1280, y: 620 },
    goalRadius: 48,
    budget: 1300,
    hint: "Build a ramp off the ledge and launch across the chasm to the far platform.",
    lines: [
      { x1: 150, y1: 205, x2: 300, y2: 245, type: "normal", fixed: true },
      { x1: 1100, y1: 660, x2: 1380, y2: 660, type: "normal", fixed: true },
    ],
  },
  {
    id: 12,
    name: "Halfpipe",
    start: { x: 200, y: 200 },
    goal: { x: 1180, y: 240 },
    goalRadius: 46,
    budget: 2200,
    hint: "Carve a smooth bowl down to the floor and up the other side.",
    lines: [
      { x1: 150, y1: 225, x2: 320, y2: 255, type: "normal", fixed: true },
      { x1: 1050, y1: 265, x2: 1280, y2: 265, type: "normal", fixed: true },
      { x1: 600, y1: 720, x2: 700, y2: 720, type: "normal", fixed: true },
    ],
  },
  {
    id: 13,
    name: "Finale",
    start: { x: 200, y: 180 },
    goal: { x: 2150, y: 760 },
    goalRadius: 52,
    budget: 4200,
    hint: "Everything you've learned. Build a long, flowing line to the distant flag.",
    lines: [
      { x1: 150, y1: 205, x2: 300, y2: 245, type: "normal", fixed: true },
      { x1: 700, y1: 480, x2: 760, y2: 720, type: "normal", fixed: true },
      { x1: 1300, y1: 540, x2: 1360, y2: 300, type: "normal", fixed: true },
      { x1: 2020, y1: 800, x2: 2260, y2: 800, type: "normal", fixed: true },
    ],
  },
];
