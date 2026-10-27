import { colorForHeight, PALETTE } from "./palette";
import { explore } from "./logic";
import { mixSeed, mulberry32, shuffle, type Rng } from "./rng";
import type {
  Block,
  Difficulty,
  GenerationParams,
  LevelData,
  LevelMetadata,
  Mechanism,
  NavEdge,
  NavNode,
  NodeKind,
} from "./types";

const DIRS = [
  { x: 1, z: 0 },
  { x: 0, z: 1 },
  { x: -1, z: 0 },
  { x: 0, z: -1 },
] as const;

type Cell = { x: number; y: number; z: number };
type Beat = "corridor" | "rotate" | "slide" | "lift" | "illusion" | "stair";

const PLANS: Record<Difficulty, Beat[]> = {
  easy: ["corridor", "rotate", "stair", "illusion", "corridor"],
  medium: ["corridor", "rotate", "slide", "stair", "illusion", "lift", "corridor"],
  hard: ["corridor", "illusion", "rotate", "lift", "slide", "stair", "illusion", "corridor"],
};

function k(c: Cell): string {
  return `${c.x},${c.y},${c.z}`;
}

/** Invariant along the isometric view ray (1,1,1). */
export function screenKey(x: number, y: number, z: number): string {
  return `${x - z}:${x + z - 2 * y}`;
}

function depthFor(y: number): number {
  if (y <= 0) return 1;
  return Math.min(y + 1, 3);
}

function inXZ(c: Cell): boolean {
  return c.x >= -8 && c.x <= 8 && c.z >= -8 && c.z <= 8;
}

function same(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

/** Orthogonal step, or a single stair (one horizontal + one vertical). */
function isNeighbor(a: Cell, b: Cell): boolean {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  const dz = Math.abs(a.z - b.z);
  if (dx + dy + dz === 1) return true;
  return dy === 1 && dx + dz === 1 && dx * dz === 0;
}

class Builder {
  readonly nodes: NavNode[] = [];
  readonly edges: NavEdge[] = [];
  readonly mechanisms: Mechanism[] = [];
  readonly blocks: Block[] = [];
  readonly occupied = new Set<string>();
  readonly screen = new Set<string>();
  heading = 0;

  constructor(readonly rng: Rng) {
    this.heading = Math.floor(rng() * 4);
  }

  headings(): number[] {
    const rest = shuffle(
      this.rng,
      [0, 1, 2, 3].filter((h) => h !== this.heading),
    );
    return [this.heading, ...rest];
  }

  private columnCells(cell: Cell): Cell[] {
    const d = depthFor(cell.y);
    const out: Cell[] = [];
    for (let i = 0; i < d; i++) out.push({ x: cell.x, y: cell.y - i, z: cell.z });
    return out;
  }

  private mark(cell: Cell) {
    this.occupied.add(k(cell));
    this.screen.add(screenKey(cell.x, cell.y, cell.z));
  }

  columnFree(cell: Cell): boolean {
    if (cell.y < 0 || cell.y > 7 || !inXZ(cell)) return false;
    for (const c of this.columnCells(cell)) {
      if (c.y < 0) return false;
      if (this.occupied.has(k(c))) return false;
      if (this.screen.has(screenKey(c.x, c.y, c.z))) return false;
    }
    return true;
  }

  cellFree(cell: Cell): boolean {
    if (cell.y < 0 || cell.y > 7 || !inXZ(cell)) return false;
    if (this.occupied.has(k(cell))) return false;
    if (this.screen.has(screenKey(cell.x, cell.y, cell.z))) return false;
    return true;
  }

  private nearNode(cell: Cell, parent: Cell | null): boolean {
    for (const n of this.nodes) {
      const p = { x: n.position[0], y: n.position[1], z: n.position[2] };
      if (parent && same(p, parent)) continue;
      if (isNeighbor(cell, p)) return true;
    }
    return false;
  }

  canStatic(cell: Cell, parent: Cell | null): boolean {
    if (!this.columnFree(cell)) return false;
    if (this.nearNode(cell, parent)) return false;
    return true;
  }

  private pushNode(cell: Cell, kind: NodeKind, mechIndex?: number): NavNode {
    const node: NavNode = {
      id: this.nodes.length,
      position: [cell.x, cell.y, cell.z],
      layer: cell.y,
      geometryId: this.blocks.length,
      isActive: true,
      isStart: false,
      isGoal: false,
      kind,
      mechIndex,
    };
    this.nodes.push(node);
    return node;
  }

  addBlock(
    position: [number, number, number],
    size: [number, number, number],
    color: string,
    blockType: Block["blockType"] = "cube",
    groupId?: string,
  ): Block {
    const block: Block = {
      id: this.blocks.length,
      position,
      size,
      rotation: [0, 0, 0],
      blockType,
      color,
      groupId,
    };
    this.blocks.push(block);
    return block;
  }

  addStatic(cell: Cell, kind: NodeKind = "static"): NavNode {
    const node = this.pushNode(cell, kind);
    const cells = this.columnCells(cell);
    cells.forEach((c, i) => {
      this.mark(c);
      this.addBlock(
        [c.x, c.y - 0.5, c.z],
        [0.98, 1, 0.98],
        colorForHeight(c.y),
        i === 0 ? "cube" : "cube",
      );
    });
    node.geometryId = this.blocks.length - cells.length;
    return node;
  }

  addPad(cell: Cell): NavNode {
    const node = this.pushNode(cell, "static");
    this.mark(cell);
    this.addBlock([cell.x, cell.y - 0.62, cell.z], [0.32, 0.76, 0.32], colorForHeight(cell.y - 1), "pillar");
    const pad = this.addBlock([cell.x, cell.y - 0.1, cell.z], [0.74, 0.2, 0.74], PALETTE.cream);
    node.geometryId = pad.id;
    return node;
  }

  addBridgeNode(cell: Cell): NavNode {
    const node = this.pushNode(cell, "bridge");
    this.mark(cell);
    return node;
  }

  addLiftNode(cell: Cell, mechIndex: number): NavNode {
    const node = this.pushNode(cell, "lift", mechIndex);
    this.mark(cell);
    this.mark({ x: cell.x, y: cell.y + 1, z: cell.z });
    this.mark({ x: cell.x, y: cell.y + 2, z: cell.z });
    return node;
  }

  link(a: NavNode, b: NavNode, condition = "", illusion = false) {
    this.edges.push({
      fromId: a.id,
      toId: b.id,
      condition,
      isIllusion: illusion,
      bidirectional: true,
    });
  }

  pos(n: NavNode): Cell {
    return { x: n.position[0], y: n.position[1], z: n.position[2] };
  }

  carve(from: NavNode, steps: number, stairs: boolean): NavNode {
    let cur = from;
    let made = 0;
    for (let i = 0; i < steps; i++) {
      const next = this.pickStep(cur, stairs && this.rng() < 0.4);
      if (!next) break;
      cur = next;
      made++;
    }
    if (made > 0 && this.rng() < 0.55) this.trySpur(cur);
    return cur;
  }

  private pickStep(cur: NavNode, stair: boolean): NavNode | null {
    const parent = this.pos(cur);
    for (const h of this.headings()) {
      const d = DIRS[h]!;
      const cell: Cell = { x: parent.x + d.x, y: parent.y, z: parent.z + d.z };
      if (!this.canStatic(cell, parent)) continue;
      const n = this.addStatic(cell);
      this.link(cur, n);
      this.heading = h;
      return n;
    }
    if (stair) {
      for (const h of this.headings()) {
        const d = DIRS[h]!;
        const up: Cell = { x: parent.x + d.x, y: parent.y + 1, z: parent.z + d.z };
        if (this.canStatic(up, parent)) {
          const n = this.addStatic(up);
          this.link(cur, n);
          this.heading = h;
          return n;
        }
        if (parent.y > 1) {
          const down: Cell = { x: parent.x + d.x, y: parent.y - 1, z: parent.z + d.z };
          if (this.canStatic(down, parent)) {
            const n = this.addStatic(down);
            this.link(cur, n);
            this.heading = h;
            return n;
          }
        }
      }
    }
    return null;
  }

  trySpur(from: NavNode): void {
    const parent = this.pos(from);
    for (const h of shuffle(this.rng, [0, 1, 2, 3])) {
      const d = DIRS[h]!;
      const cell: Cell = { x: parent.x + d.x, y: parent.y, z: parent.z + d.z };
      if (!this.canStatic(cell, parent)) continue;
      const n = this.addStatic(cell);
      this.link(from, n);
      this.finial(n);
      const cell2: Cell = { x: cell.x + d.x, y: cell.y, z: cell.z + d.z };
      if (this.canStatic(cell2, cell)) {
        const n2 = this.addStatic(cell2);
        this.link(n, n2);
        this.finial(n2);
      }
      return;
    }
  }

  finial(node: NavNode) {
    const [x, y, z] = node.position;
    const side = this.rng() < 0.5 ? 1 : -1;
    this.addBlock(
      [x + 0.34 * side, y + 0.28, z + 0.34 * side],
      [0.12, 0.56, 0.12],
      this.rng() < 0.5 ? PALETTE.tealDeep : PALETTE.coralDeep,
      "pillar",
    );
  }

  placeRotate(entry: NavNode): NavNode | null {
    for (const h of this.headings()) {
      const f = DIRS[h]!;
      const left = { x: -f.z, z: f.x };
      const p0 = this.pos(entry);
      const center: Cell = { x: p0.x + f.x * 2, y: p0.y, z: p0.z + f.z * 2 };
      const opposite: Cell = { x: p0.x + f.x * 4, y: p0.y, z: p0.z + f.z * 4 };
      const leftD: Cell = { x: center.x + left.x * 2, y: center.y, z: center.z + left.z * 2 };
      const rightD: Cell = { x: center.x - left.x * 2, y: center.y, z: center.z - left.z * 2 };
      const gaps0: Cell[] = [
        { x: center.x - f.x, y: center.y, z: center.z - f.z },
        { x: center.x + f.x, y: center.y, z: center.z + f.z },
      ];
      const gaps1: Cell[] = [
        { x: center.x + left.x, y: center.y, z: center.z + left.z },
        { x: center.x - left.x, y: center.y, z: center.z - left.z },
      ];
      if (!this.cellFree(center)) continue;
      if (!this.canStatic(opposite, null) || !this.canStatic(leftD, null) || !this.canStatic(rightD, null)) {
        continue;
      }
      if ([...gaps0, ...gaps1].some((g) => !this.cellFree(g))) continue;
      // Doorways must not secretly touch the entry plaza.
      if (isNeighbor(opposite, p0) || isNeighbor(leftD, p0) || isNeighbor(rightD, p0)) continue;

      const mi = this.mechanisms.length;
      const cond0 = `m${mi}==0`;
      const cond1 = `m${mi}==1`;
      const pivot = this.addPad(center);
      const gapNodes0 = gaps0.map((g) => this.addBridgeNode(g));
      const gapNodes1 = gaps1.map((g) => this.addBridgeNode(g));
      const opp = this.addStatic(opposite);
      const leftN = this.addStatic(leftD);
      const rightN = this.addStatic(rightD);

      const alongX = Math.abs(f.x) === 1;
      const slabSize: [number, number, number] = alongX ? [1.38, 0.22, 0.68] : [0.68, 0.22, 1.38];
      const id = `m${mi}`;
      for (const g of gaps0) {
        this.addBlock(
          [g.x, g.y - 0.08, g.z],
          slabSize,
          PALETTE.cream,
          "slab",
          id,
        );
      }

      this.link(entry, gapNodes0[0]!, cond0);
      this.link(gapNodes0[0]!, pivot, cond0);
      this.link(pivot, gapNodes0[1]!, cond0);
      this.link(gapNodes0[1]!, opp, cond0);
      this.link(leftN, gapNodes1[0]!, cond1);
      this.link(gapNodes1[0]!, pivot, cond1);
      this.link(pivot, gapNodes1[1]!, cond1);
      this.link(gapNodes1[1]!, rightN, cond1);

      this.mechanisms.push({
        id,
        type: "rotate",
        currentState: 0,
        possibleStates: [0, 1],
        params: {
          controls: [pivot.id],
          label: "圆台",
          aha: "圆台转过直角，另一侧的门才接上。",
          pivot: [center.x, center.y, center.z],
          turn: Math.PI / 2,
        },
      });

      this.finial(opp);
      const useLeft = this.rng() < 0.5;
      const exit = useLeft ? leftN : rightN;
      const decoy = useLeft ? rightN : leftN;
      this.finial(decoy);
      this.trySpur(decoy);
      this.trySpur(opp);
      // Exit faces outward from the pivot.
      if (useLeft) {
        this.heading = DIRS.findIndex((d) => d.x === left.x && d.z === left.z);
      } else {
        this.heading = DIRS.findIndex((d) => d.x === -left.x && d.z === -left.z);
      }
      return exit;
    }
    return null;
  }

  placeSlide(entry: NavNode): NavNode | null {
    for (const h of this.headings()) {
      const f = DIRS[h]!;
      const side = { x: -f.z, z: f.x };
      const p0 = this.pos(entry);
      const gap: Cell = { x: p0.x + f.x, y: p0.y, z: p0.z + f.z };
      const beyond: Cell = { x: p0.x + f.x * 2, y: p0.y, z: p0.z + f.z * 2 };
      const park: Cell = { x: gap.x + side.x, y: gap.y, z: gap.z + side.z };
      if (!this.cellFree(gap) || !this.cellFree(park)) continue;
      if (!this.canStatic(beyond, null)) continue;
      if (isNeighbor(beyond, p0)) continue;

      const mi = this.mechanisms.length;
      const id = `m${mi}`;
      const cond = `m${mi}==1`;
      const gapNode = this.addBridgeNode(gap);
      this.mark(park);
      const exit = this.addStatic(beyond);
      const alongX = Math.abs(f.x) === 1;
      this.addBlock(
        [park.x, park.y - 0.1, park.z],
        alongX ? [1.22, 0.24, 0.78] : [0.78, 0.24, 1.22],
        PALETTE.creamDeep,
        "slab",
        id,
      );
      this.addBlock(
        [p0.x + side.x * 0.34, p0.y + 0.16, p0.z + side.z * 0.34],
        [0.28, 0.16, 0.28],
        PALETTE.gold,
        "button",
      );
      this.link(entry, gapNode, cond);
      this.link(gapNode, exit, cond);
      this.mechanisms.push({
        id,
        type: "slide",
        currentState: 0,
        possibleStates: [0, 1],
        params: {
          controls: [entry.id],
          label: "滑桥",
          aha: "滑板填上缺口之前，对面只是景色。",
          delta: [gap.x - park.x, 0, gap.z - park.z],
        },
      });
      this.heading = h;
      return exit;
    }
    return null;
  }

  placeLift(entry: NavNode): NavNode | null {
    for (const h of this.headings()) {
      const f = DIRS[h]!;
      const p0 = this.pos(entry);
      const plat: Cell = { x: p0.x + f.x, y: p0.y, z: p0.z + f.z };
      const risen: Cell = { x: plat.x, y: plat.y + 2, z: plat.z };
      const high: Cell = { x: plat.x + f.x, y: plat.y + 2, z: plat.z + f.z };
      if (!this.cellFree(plat) || !this.cellFree(risen)) continue;
      if (!this.cellFree({ x: plat.x, y: plat.y + 1, z: plat.z })) continue;
      if (!this.canStatic(high, null)) continue;

      const mi = this.mechanisms.length;
      const id = `m${mi}`;
      const lift = this.addLiftNode(plat, mi);
      const exit = this.addStatic(high);
      this.addBlock([plat.x, plat.y - 0.9, plat.z], [0.36, 1.1, 0.36], PALETTE.tealDeep, "pillar");
      this.addBlock(
        [plat.x, plat.y - 0.12, plat.z],
        [0.96, 0.26, 0.96],
        PALETTE.cream,
        "slab",
        id,
      );
      this.link(entry, lift, `m${mi}==0`);
      this.link(lift, exit, `m${mi}==1`);
      this.mechanisms.push({
        id,
        type: "lift",
        currentState: 0,
        possibleStates: [0, 1],
        params: {
          controls: [entry.id, lift.id, exit.id],
          label: "升降",
          aha: "升降台升起之后，高处的回廊才够得着。",
          delta: [0, 2, 0],
        },
      });
      this.heading = h;
      return exit;
    }
    return null;
  }

  placeIllusion(entry: NavNode): NavNode | null {
    const p0 = this.pos(entry);
    for (const h of this.headings()) {
      const f = DIRS[h]!;
      for (const t of [2, 3, 4]) {
        const top: Cell = {
          x: p0.x + f.x + t,
          y: p0.y + t,
          z: p0.z + f.z + t,
        };
        if (top.y > 7 || !inXZ(top)) continue;
        const depth = depthFor(p0.y);
        const col: Cell[] = [];
        for (let i = 0; i < depth; i++) col.push({ x: top.x, y: top.y - i, z: top.z });
        if (col.some((c) => c.y < 0 || c.y > 7 || this.occupied.has(k(c)))) continue;
        if (col.some((c) => this.screen.has(screenKey(c.x, c.y, c.z)))) continue;
        if (this.nearNode(top, null)) continue;
        // The visual slot one step ahead must be empty in screen space — it is `top`.
        const mi = this.mechanisms.length;
        const id = `m${mi}`;
        const node = this.pushNode(top, "illusion");
        for (const c of col) {
          this.mark(c);
          this.addBlock([c.x, c.y - 0.5, c.z], [0.98, 1, 0.98], colorForHeight(p0.y - (top.y - c.y)));
        }
        const side = this.rng() < 0.5 ? 1 : -1;
        this.addBlock(
          [p0.x + 0.36 * side, p0.y + 0.14, p0.z + 0.36 * side],
          [0.3, 0.14, 0.3],
          PALETTE.gold,
          "button",
        );
        this.link(entry, node, `m${mi}==1`, true);
        this.mechanisms.push({
          id,
          type: "button",
          currentState: 0,
          possibleStates: [0, 1],
          params: {
            controls: [entry.id],
            label: "齿轮",
            aha: "等距视角里相接的两阶，在空间里其实分开。拨动齿轮，假缝才会答应。",
          },
        });
        this.heading = h;
        return node;
      }
    }
    return null;
  }

  stair(entry: NavNode): NavNode | null {
    return this.pickStep(entry, true);
  }

  shrine(goal: NavNode) {
    const [x, y, z] = goal.position;
    for (const b of this.blocks) {
      if (b.groupId) continue;
      if (Math.abs(b.position[0] - x) < 0.01 && Math.abs(b.position[2] - z) < 0.01) {
        if (Math.abs(b.position[1] - (y - 0.5)) < 0.01) b.color = PALETTE.gold;
      }
    }
    this.addBlock([x + 0.4, y + 0.55, z], [0.12, 1.1, 0.12], PALETTE.gold, "pillar");
    this.addBlock([x - 0.4, y + 0.55, z], [0.12, 1.1, 0.12], PALETTE.gold, "pillar");
    this.addBlock([x, y + 1.16, z], [1.02, 0.12, 0.14], PALETTE.gold, "pillar");
  }
}

function emptyMeta(seed: number, difficulty: Difficulty): LevelMetadata {
  return {
    seed,
    difficulty,
    solvable: false,
    shortestSteps: -1,
    stateSpace: 0,
    mechanismCount: 0,
    illusionCount: 0,
    nodeCount: 0,
    edgeCount: 0,
    aha: [],
    initialStates: [],
    generator: "backward-construction",
    attempts: 0,
    fallback: false,
  };
}

function finish(
  b: Builder,
  intended: NavNode | null,
  seed: number,
  difficulty: Difficulty,
  attempts: number,
  fallback: boolean,
): LevelData | null {
  if (b.nodes.length < 2) return null;
  const start = b.nodes[0]!;
  start.isStart = true;
  let goalNode: NavNode | null =
    intended && intended.id !== start.id && (intended.kind === "static" || intended.kind === "illusion")
      ? intended
      : null;
  if (!goalNode) {
    for (let i = b.nodes.length - 1; i >= 0; i--) {
      const n = b.nodes[i]!;
      if (n.id !== start.id && (n.kind === "static" || n.kind === "illusion")) {
        goalNode = n;
        break;
      }
    }
  }
  if (!goalNode) return null;
  goalNode.isGoal = true;
  b.shrine(goalNode);

  const seen = new Map<string, number>();
  for (const mech of b.mechanisms) {
    const base = mech.params.label;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    if (n > 1) mech.params.label = `${base}${["", "二", "三", "四"][n - 1] ?? n}`;
  }

  const level: LevelData = {
    nodes: b.nodes,
    edges: b.edges,
    mechanisms: b.mechanisms,
    blocks: b.blocks,
    startNodeId: start.id,
    goalNodeId: goalNode.id,
    metadata: emptyMeta(seed, difficulty),
  };
  const report = explore(
    level,
    start.id,
    b.mechanisms.map((m) => m.currentState),
  );
  const illusions = b.edges.filter((e) => e.isIllusion).length;
  level.metadata = {
    seed,
    difficulty,
    solvable: report.solvable,
    shortestSteps: report.shortestSteps,
    stateSpace: report.stateSpace,
    mechanismCount: b.mechanisms.length,
    illusionCount: illusions,
    nodeCount: b.nodes.length,
    edgeCount: b.edges.length,
    aha: b.mechanisms.map((m) => m.params.aha),
    initialStates: b.mechanisms.map((m) => m.currentState),
    generator: "backward-construction",
    attempts,
    fallback,
  };
  return level;
}

function runPlan(b: Builder, difficulty: Difficulty, loose: boolean): NavNode {
  const startCell: Cell = { x: 0, y: 1, z: 0 };
  const start = b.addStatic(startCell);
  b.trySpur(start);
  let cursor = start;
  const plan = PLANS[difficulty];
  let corridors = 0;
  for (const beat of plan) {
    if (beat === "corridor") {
      const len = corridors === 0 ? (difficulty === "easy" ? 3 : 4) : loose ? 2 : 2;
      corridors++;
      cursor = b.carve(cursor, len, true);
    } else if (beat === "stair") {
      cursor = b.stair(cursor) ?? cursor;
    } else if (beat === "rotate") {
      cursor = b.placeRotate(cursor) ?? b.carve(cursor, loose ? 2 : 1, true);
    } else if (beat === "slide") {
      cursor = b.placeSlide(cursor) ?? b.carve(cursor, 1, false);
    } else if (beat === "lift") {
      cursor = b.placeLift(cursor) ?? b.carve(cursor, 1, true);
    } else if (beat === "illusion") {
      cursor = b.placeIllusion(cursor) ?? b.carve(cursor, loose ? 2 : 1, true);
    }
  }
  if (cursor.id === start.id) cursor = b.carve(start, 4, true);
  return cursor;
}

function acceptable(level: LevelData, difficulty: Difficulty, loose: boolean): boolean {
  const m = level.metadata;
  if (!m.solvable) return false;
  if (m.shortestSteps < 4) return false;
  const needIll = loose ? 1 : difficulty === "hard" ? 2 : 1;
  const needMech = loose ? 2 : difficulty === "easy" ? 2 : difficulty === "medium" ? 3 : 4;
  const needNodes = loose ? 8 : difficulty === "easy" ? 8 : 12;
  return m.illusionCount >= needIll && m.mechanismCount >= needMech && m.nodeCount >= needNodes;
}

function buildOnce(sub: number, difficulty: Difficulty, loose: boolean): LevelData | null {
  const b = new Builder(mulberry32(sub));
  const cursor = runPlan(b, difficulty, loose);
  return finish(b, cursor, sub, difficulty, 0, false);
}

/**
 * Backward-style construction: the critical path is laid first,
 * gadgets only open along that path, then a state-space search confirms it.
 * Output is a pure function of (seed, difficulty).
 */
export function generateLevel(params: GenerationParams): LevelData {
  const seed = params.seed;
  const difficulty = params.difficulty;
  let best: LevelData | null = null;
  let looseBest: LevelData | null = null;
  for (let attempt = 0; attempt < 18; attempt++) {
    const sub = attempt === 0 ? seed >>> 0 : mixSeed(seed, attempt);
    const level = buildOnce(sub, difficulty, attempt >= 12);
    if (!level) continue;
    level.metadata.seed = seed;
    level.metadata.attempts = attempt + 1;
    level.metadata.fallback = false;
    if (acceptable(level, difficulty, false)) return level;
    if (!looseBest && acceptable(level, difficulty, true)) looseBest = level;
    if (level.metadata.solvable && (!best || level.metadata.shortestSteps > best.metadata.shortestSteps)) {
      best = level;
    }
  }
  if (looseBest) return looseBest;
  if (best) return best;
  return buildFallback(seed, difficulty);
}

function buildFallback(seed: number, difficulty: Difficulty): LevelData {
  const b = new Builder(mulberry32(1));
  b.heading = 0;
  const start = b.addStatic({ x: 0, y: 1, z: 0 });
  let cursor = start;
  for (let i = 0; i < 3; i++) {
    const n = b.addStatic({ x: i + 1, y: 1, z: 0 });
    b.link(cursor, n);
    cursor = n;
  }
  const rotated = b.placeRotate(cursor);
  cursor = rotated ?? cursor;
  const ill = b.placeIllusion(cursor);
  cursor = ill ?? cursor;
  const extra = b.addStatic({
    x: cursor.position[0] + 1,
    y: cursor.position[1],
    z: cursor.position[2],
  });
  // May fail canStatic rules — place raw if the cell is free.
  if (!b.occupied.has(`${cursor.position[0] + 1},${cursor.position[1]},${cursor.position[2]}`)) {
    b.link(cursor, extra);
    cursor = extra;
  }
  const level = finish(b, cursor, seed, difficulty, 1, true);
  if (level && level.metadata.solvable) return level;
  // Absolute minimum: a straight walk, still flagged solvable.
  const tiny = new Builder(mulberry32(2));
  const a = tiny.addStatic({ x: 0, y: 1, z: 0 });
  const c = tiny.addStatic({ x: 1, y: 1, z: 0 });
  const d = tiny.addStatic({ x: 2, y: 1, z: 0 });
  tiny.link(a, c);
  tiny.link(c, d);
  const done = finish(tiny, d, seed, difficulty, 1, true)!;
  done.metadata.solvable = true;
  return done;
}
