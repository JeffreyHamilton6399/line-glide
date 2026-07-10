export type Vec = { x: number; y: number };
export type LineType = "normal" | "boost";

export type GameLine = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  type: LineType;
  /** Fixed lines are part of the level and cannot be erased by the player. */
  fixed?: boolean;
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
    ],
  },
];
