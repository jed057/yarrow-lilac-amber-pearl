import type { ExploreResult, LevelData, NavEdge, StepAction } from "./types";

export function isEdgeOpen(edge: NavEdge, states: readonly number[]): boolean {
  if (!edge.condition) return true;
  const parts = edge.condition.split("&&");
  for (const part of parts) {
    const m = /^m(\d+)==(\d+)$/.exec(part.trim());
    if (!m) return false;
    if ((states[Number(m[1])] ?? -1) !== Number(m[2])) return false;
  }
  return true;
}

export function neighborsOf(
  level: LevelData,
  nodeId: number,
  states: readonly number[],
): number[] {
  const out: number[] = [];
  for (const e of level.edges) {
    if (!isEdgeOpen(e, states)) continue;
    if (e.fromId === nodeId) out.push(e.toId);
    else if (e.bidirectional && e.toId === nodeId) out.push(e.fromId);
  }
  return out;
}

/** Walk-only BFS on the graph with mechanisms frozen. Includes `from`. */
export function findPath(
  level: LevelData,
  from: number,
  to: number,
  states: readonly number[],
): number[] | null {
  if (from === to) return [from];
  const q = [from];
  const prev = new Map<number, number>();
  prev.set(from, -1);
  while (q.length) {
    const cur = q.shift()!;
    for (const nxt of neighborsOf(level, cur, states)) {
      if (prev.has(nxt)) continue;
      prev.set(nxt, cur);
      if (nxt === to) {
        const path = [to];
        let p = cur;
        while (p !== -1) {
          path.push(p);
          p = prev.get(p)!;
        }
        path.reverse();
        return path;
      }
      q.push(nxt);
    }
  }
  return null;
}

function stateKey(nodeId: number, states: readonly number[]): string {
  return `${nodeId}|${states.join(",")}`;
}

/**
 * Full state-space search: (node, mechanism states).
 * Exhausts the reachable component so `stateSpace` is a real count,
 * and records a shortest path of walks and toggles to the goal.
 */
export function explore(
  level: LevelData,
  startNode: number,
  startStates: readonly number[],
): ExploreResult {
  const mechs = level.mechanisms;
  const goal = level.goalNodeId;
  type NodeRec = {
    n: number;
    s: number[];
    prev: number;
    action?: StepAction;
  };
  const recs: NodeRec[] = [];
  const index = new Map<string, number>();
  const q: number[] = [];

  const push = (n: number, s: number[], prev: number, action?: StepAction) => {
    const k = stateKey(n, s);
    if (index.has(k)) return;
    const i = recs.length;
    recs.push({ n, s, prev, action });
    index.set(k, i);
    q.push(i);
  };

  push(startNode, startStates.slice(), -1);

  let goalIndex = -1;
  let guard = 0;
  while (q.length && guard < 80000) {
    guard++;
    const i = q.shift()!;
    const rec = recs[i]!;
    if (goalIndex < 0 && rec.n === goal) goalIndex = i;

    for (const nxt of neighborsOf(level, rec.n, rec.s)) {
      push(nxt, rec.s, i, { kind: "walk", to: nxt });
    }

    for (let mi = 0; mi < mechs.length; mi++) {
      const mech = mechs[mi]!;
      if (!mech.params.controls.includes(rec.n)) continue;
      const opts = mech.possibleStates;
      const cur = opts.indexOf(rec.s[mi]!);
      const toState = opts[(cur + 1) % opts.length]!;
      if (toState === rec.s[mi]) continue;
      const ns = rec.s.slice();
      ns[mi] = toState;
      push(rec.n, ns, i, { kind: "toggle", mech: mi, toState });
    }
  }

  const actions: StepAction[] = [];
  if (goalIndex >= 0) {
    let i = goalIndex;
    while (recs[i]!.prev >= 0) {
      const a = recs[i]!.action;
      if (a) actions.push(a);
      i = recs[i]!.prev;
    }
    actions.reverse();
  }

  return {
    solvable: goalIndex >= 0,
    shortestSteps: goalIndex >= 0 ? actions.length : -1,
    stateSpace: recs.length,
    actions,
  };
}
