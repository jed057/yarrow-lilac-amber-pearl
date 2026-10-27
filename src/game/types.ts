export type Difficulty = "easy" | "medium" | "hard";

export type MechanismType = "rotate" | "slide" | "lift" | "button";

export type NodeKind = "static" | "bridge" | "lift" | "illusion";

export type BlockType = "cube" | "slab" | "button" | "pillar";

export interface NavNode {
  id: number;
  position: [number, number, number];
  layer: number;
  geometryId: number;
  isActive: boolean;
  isStart: boolean;
  isGoal: boolean;
  kind: NodeKind;
  /** Set when the node's floor moves with a mechanism (lifts). */
  mechIndex?: number;
}

export interface NavEdge {
  fromId: number;
  toId: number;
  /** Empty string = always open. Otherwise `m0==1&&m1==0`. */
  condition: string;
  isIllusion: boolean;
  bidirectional: boolean;
}

export interface MechanismParams {
  controls: number[];
  label: string;
  aha: string;
  pivot?: [number, number, number];
  /** World translation applied at state 1 (slide / lift). */
  delta?: [number, number, number];
  /** Y rotation (radians) applied at state 1 (rotate). */
  turn?: number;
}

export interface Mechanism {
  id: string;
  type: MechanismType;
  currentState: number;
  possibleStates: number[];
  params: MechanismParams;
}

export interface Block {
  id: number;
  position: [number, number, number];
  size: [number, number, number];
  rotation: [number, number, number];
  blockType: BlockType;
  color: string;
  groupId?: string;
}

export interface LevelMetadata {
  seed: number;
  difficulty: Difficulty;
  solvable: boolean;
  shortestSteps: number;
  stateSpace: number;
  mechanismCount: number;
  illusionCount: number;
  nodeCount: number;
  edgeCount: number;
  aha: string[];
  initialStates: number[];
  generator: string;
  attempts: number;
  fallback: boolean;
}

export interface LevelData {
  nodes: NavNode[];
  edges: NavEdge[];
  mechanisms: Mechanism[];
  blocks: Block[];
  startNodeId: number;
  goalNodeId: number;
  metadata: LevelMetadata;
}

export interface GenerationParams {
  seed: number;
  difficulty: Difficulty;
}

export type StepAction =
  | { kind: "walk"; to: number }
  | { kind: "toggle"; mech: number; toState: number };

export interface ExploreResult {
  solvable: boolean;
  shortestSteps: number;
  stateSpace: number;
  actions: StepAction[];
}
