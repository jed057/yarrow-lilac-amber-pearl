import * as THREE from "three";
import {
  bindAudioLifecycle,
  disposeAudio,
  isMuted,
  playDeny,
  playStep,
  playToggle,
  playWin,
  toggleMuted,
  unlockAudio,
} from "./audio";
import { generateLevel } from "./generate";
import { findPath, neighborsOf } from "./logic";
import { PALETTE } from "./palette";
import type { Difficulty, LevelData, LevelMetadata, MechanismType } from "./types";

export type HudState = {
  seed: number;
  difficulty: Difficulty;
  steps: number;
  status: "play" | "won";
  mechs: { id: string; label: string; type: MechanismType; state: number }[];
  metrics: LevelMetadata;
  flash: string | null;
  muted: boolean;
  peeking: boolean;
  hint: string | null;
};

export type GameHandle = {
  dispose: () => void;
  newLevel: (opts?: { seed?: number; difficulty?: Difficulty }) => void;
  reset: () => void;
  hint: () => void;
  toggleMute: () => void;
  togglePeek: () => void;
  exportJson: () => string;
  getSeed: () => number;
  getDifficulty: () => Difficulty;
};

const smooth = (t: number) => t * t * (3 - 2 * t);

function mechPhrase(type: MechanismType, state: number): string {
  if (type === "rotate") return state ? "已转向" : "待转向";
  if (type === "slide") return state ? "已架上" : "未架上";
  if (type === "lift") return state ? "在高处" : "在低处";
  return state ? "已开启" : "未开启";
}

export function mountGame(
  el: HTMLElement,
  onHud: (h: HudState) => void,
  init?: { seed?: number; difficulty?: Difficulty },
): GameHandle {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const unbindVis = bindAudioLifecycle();

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setClearColor(PALETTE.sky, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.touchAction = "none";
  renderer.domElement.style.display = "block";
  el.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.sky, 42, 86);

  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 200);
  const lookTarget = new THREE.Vector3(0, 1, 0);
  let frustumSize = 14;
  let camDist = 36;

  const hemi = new THREE.HemisphereLight(PALETTE.sun, PALETTE.teal, 0.85);
  scene.add(hemi);
  const key = new THREE.DirectionalLight("#fff4e5", 1.45);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.00035;
  key.shadow.normalBias = 0.04;
  const shadowCam = key.shadow.camera;
  shadowCam.near = 1;
  shadowCam.far = 60;
  shadowCam.left = -16;
  shadowCam.right = 16;
  shadowCam.top = 16;
  shadowCam.bottom = -16;
  scene.add(key);
  scene.add(key.target);
  const fill = new THREE.DirectionalLight("#f0c2b4", 0.38);
  scene.add(fill);

  const sun = new THREE.Mesh(
    new THREE.CircleGeometry(5.2, 64),
    new THREE.MeshBasicMaterial({ color: PALETTE.sun, depthWrite: false }),
  );
  sun.renderOrder = -1;
  scene.add(sun);

  const water = new THREE.Mesh(
    new THREE.CircleGeometry(26, 64),
    new THREE.MeshStandardMaterial({
      color: PALETTE.water,
      transparent: true,
      opacity: 0.42,
      roughness: 0.12,
      metalness: 0.04,
    }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = -1.35;
  water.receiveShadow = true;
  scene.add(water);

  const world = new THREE.Group();
  scene.add(world);

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 18);
  const pickGeo = new THREE.BoxGeometry(0.78, 0.7, 0.78);
  const markGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.04, 10);
  const dotGeo = new THREE.SphereGeometry(0.07, 8, 8);
  const gemGeo = new THREE.OctahedronGeometry(0.2, 0);
  const shared = new Set<THREE.BufferGeometry>([boxGeo, cylGeo, pickGeo, markGeo, dotGeo, gemGeo]);

  const mats = new Map<string, THREE.MeshStandardMaterial>();
  const matFor = (color: string, rough = 0.86) => {
    const keyColor = `${color}|${rough}`;
    let m = mats.get(keyColor);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
      mats.set(keyColor, m);
    }
    return m;
  };
  const pickMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const markMat = new THREE.MeshBasicMaterial({ color: PALETTE.gold });
  const pathMat = new THREE.MeshBasicMaterial({ color: PALETTE.coralDeep });

  const character = new THREE.Group();
  const dress = new THREE.Mesh(
    new THREE.ConeGeometry(0.2, 0.48, 6),
    matFor(PALETTE.dress, 0.7),
  );
  dress.position.y = 0.24;
  dress.castShadow = true;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), matFor(PALETTE.skin, 0.65));
  head.position.y = 0.56;
  head.castShadow = true;
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.2, 6), matFor(PALETTE.coralDeep, 0.55));
  hat.position.y = 0.74;
  hat.castShadow = true;
  character.add(dress, head, hat);
  scene.add(character);

  const pathDots: THREE.Mesh[] = [];
  for (let i = 0; i < 28; i++) {
    const d = new THREE.Mesh(dotGeo, pathMat);
    d.visible = false;
    d.castShadow = false;
    scene.add(d);
    pathDots.push(d);
  }

  const timer = new THREE.Timer();
  timer.connect(document);

  let seed = init?.seed ?? 42;
  let difficulty: Difficulty = init?.difficulty ?? "medium";
  let level: LevelData = generateLevel({ seed, difficulty });
  let states: number[] = [];
  let visual: number[] = [];
  let playerNode = 0;
  let steps = 0;
  let status: "play" | "won" = "play";
  let flash: string | null = null;
  let flashUntil = 0;
  let hintText: string | null = null;
  let time = 0;
  let yaw = 0;
  let pitch = 0;
  let yawTarget = 0;
  let pitchTarget = 0;
  let shake = 0;
  const reachable = new Set<number>();
  let pulseNode: number | null = null;

  const mechGroups: { index: number; group: THREE.Group }[] = [];
  const pickByNode: THREE.Mesh[] = [];
  const markerByNode: THREE.Mesh[] = [];
  let gem: THREE.Mesh | null = null;
  const pickables: THREE.Object3D[] = [];

  const vTmp = new THREE.Vector3();
  const vTmp2 = new THREE.Vector3();

  type Seg = { to: number; from: THREE.Vector3; dest: THREE.Vector3; t: number; dur: number };
  let walk: { segs: Seg[]; i: number } | null = null;
  let mechAnim: { index: number; from: number; to: number; t: number; dur: number } | null = null;
  const bits: { mesh: THREE.Mesh; v: THREE.Vector3; life: number }[] = [];

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let dragging = false;
  let moved = false;
  let downX = 0;
  let downY = 0;
  let hoverNode: number | null = null;

  function say(text: string, secs = 2.4) {
    flash = text;
    flashUntil = time + secs;
    emit();
  }

  function worldOf(nodeId: number, out = vTmp): THREE.Vector3 {
    const n = level.nodes[nodeId]!;
    out.set(n.position[0], n.position[1], n.position[2]);
    if (n.kind === "lift" && n.mechIndex !== undefined) {
      const d = level.mechanisms[n.mechIndex]?.params.delta;
      const t = visual[n.mechIndex] ?? 0;
      if (d) out.x += d[0] * t, (out.y += d[1] * t), (out.z += d[2] * t);
    }
    return out;
  }

  function applyMechs() {
    for (const { index, group } of mechGroups) {
      const mech = level.mechanisms[index]!;
      const t = visual[index] ?? 0;
      if (mech.type === "rotate") {
        group.rotation.y = (mech.params.turn ?? Math.PI / 2) * t;
      } else {
        const d = mech.params.delta ?? [0, 0, 0];
        group.position.set(d[0] * t, d[1] * t, d[2] * t);
      }
    }
  }

  function refreshReachable() {
    reachable.clear();
    const q = [playerNode];
    reachable.add(playerNode);
    while (q.length) {
      const c = q.shift()!;
      for (const n of neighborsOf(level, c, states)) {
        if (reachable.has(n)) continue;
        reachable.add(n);
        q.push(n);
      }
    }
    markerByNode.forEach((m, id) => {
      m.visible = status === "play" && reachable.has(id) && id !== playerNode;
    });
  }

  function hidePath() {
    for (const d of pathDots) d.visible = false;
  }

  function showPath(ids: number[] | null) {
    hidePath();
    if (!ids) return;
    ids.forEach((id, i) => {
      if (i === 0 || i >= pathDots.length) return;
      const dot = pathDots[i]!;
      worldOf(id, vTmp2);
      dot.position.set(vTmp2.x, vTmp2.y + 0.16, vTmp2.z);
      dot.visible = true;
    });
  }

  function snapshot(): HudState {
    return {
      seed,
      difficulty,
      steps,
      status,
      mechs: level.mechanisms.map((m) => ({
        id: m.id,
        label: m.params.label,
        type: m.type,
        state: m.currentState,
      })),
      metrics: level.metadata,
      flash,
      muted: isMuted(),
      peeking: Math.abs(yaw) > 0.08 || Math.abs(pitch) > 0.08,
      hint: hintText,
    };
  }

  function emit() {
    onHud(snapshot());
  }

  function frameLevel() {
    const box = new THREE.Box3();
    for (const n of level.nodes) {
      box.expandByPoint(new THREE.Vector3(n.position[0], n.position[1], n.position[2]));
      box.expandByPoint(new THREE.Vector3(n.position[0], n.position[1] - 1.2, n.position[2]));
    }
    box.getCenter(lookTarget);
    const size = box.getSize(new THREE.Vector3());
    const worldW = size.x + size.z;
    const worldH = size.y + worldW * 0.25;
    const rect = el.getBoundingClientRect();
    const aspect = Math.max(0.5, rect.width / Math.max(1, rect.height));
    frustumSize = Math.max(worldH, worldW / aspect) * 0.62 + 2.6;
    const s = Math.max(worldW, worldH) * 0.7 + 6;
    shadowCam.left = -s;
    shadowCam.right = s;
    shadowCam.top = s;
    shadowCam.bottom = -s;
    shadowCam.updateProjectionMatrix();
    resize();
  }

  function resize() {
    const rect = el.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    const aspect = w / h;
    camera.left = (-frustumSize * aspect) / 2;
    camera.right = (frustumSize * aspect) / 2;
    camera.top = frustumSize / 2;
    camera.bottom = -frustumSize / 2;
    camera.updateProjectionMatrix();
  }

  function updateCamera() {
    const base = new THREE.Vector3(1, 1, 1).normalize();
    const worldUp = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(worldUp, base).normalize();
    const qYaw = new THREE.Quaternion().setFromAxisAngle(worldUp, yaw);
    const qPitch = new THREE.Quaternion().setFromAxisAngle(right, pitch);
    const dir = base.clone().applyQuaternion(qYaw).applyQuaternion(qPitch).normalize();
    camera.up.set(0, 1, 0);
    camera.position.copy(lookTarget).addScaledVector(dir, camDist);
    if (shake > 0) {
      camera.position.x += (Math.random() - 0.5) * 0.12 * shake * 8;
      camera.position.y += (Math.random() - 0.5) * 0.08 * shake * 8;
    }
    camera.lookAt(lookTarget);
    camera.updateMatrixWorld();
    key.position.copy(lookTarget).add(new THREE.Vector3(9, 16, 6));
    key.target.position.copy(lookTarget);
    fill.position.copy(lookTarget).add(new THREE.Vector3(-8, 5, -3));
    const camRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const camUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    sun.position
      .copy(lookTarget)
      .addScaledVector(camRight, -frustumSize * 0.28)
      .addScaledVector(camUp, frustumSize * 0.28)
      .addScaledVector(dir, -6);
    sun.lookAt(camera.position);
    sun.scale.setScalar(Math.max(1, frustumSize / 14));
  }

  function burst() {
    worldOf(level.goalNodeId, vTmp2);
    for (const b of bits) {
      b.mesh.visible = true;
      b.mesh.position.copy(vTmp2);
      b.mesh.position.y += 0.8;
      b.v.set((Math.random() - 0.5) * 1.4, 1.2 + Math.random(), (Math.random() - 0.5) * 1.4);
      b.life = 1;
    }
  }

  function clearWorld() {
    world.clear();
    mechGroups.length = 0;
    pickByNode.length = 0;
    markerByNode.length = 0;
    pickables.length = 0;
    gem = null;
    hidePath();
  }

  function build(next: LevelData) {
    clearWorld();
    level = next;
    states = next.mechanisms.map((m) => m.currentState);
    visual = states.slice();
    playerNode = next.startNodeId;
    steps = 0;
    status = "play";
    walk = null;
    mechAnim = null;
    hintText = null;
    pulseNode = null;
    flash = null;

    const groups = new Map<string, THREE.Group>();
    next.mechanisms.forEach((mech, index) => {
      const g = new THREE.Group();
      if (mech.type === "rotate" && mech.params.pivot) {
        g.position.set(mech.params.pivot[0], mech.params.pivot[1], mech.params.pivot[2]);
      }
      world.add(g);
      groups.set(mech.id, g);
      mechGroups.push({ index, group: g });
    });

    for (const block of next.blocks) {
      const geo = block.blockType === "button" ? cylGeo : boxGeo;
      const mesh = new THREE.Mesh(geo, matFor(block.color, block.blockType === "slab" ? 0.72 : 0.88));
      mesh.scale.set(block.size[0], block.size[1], block.size[2]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const group = block.groupId ? groups.get(block.groupId) : undefined;
      if (group && block.groupId) {
        const mech = next.mechanisms.find((m) => m.id === block.groupId)!;
        const idx = next.mechanisms.findIndex((m) => m.id === block.groupId);
        if (mech.type === "rotate" && mech.params.pivot) {
          const p = mech.params.pivot;
          mesh.position.set(block.position[0] - p[0], block.position[1] - p[1], block.position[2] - p[2]);
        } else {
          mesh.position.set(block.position[0], block.position[1], block.position[2]);
        }
        mesh.userData.mechIndex = idx;
        group.add(mesh);
        pickables.push(mesh);
      } else {
        mesh.position.set(block.position[0], block.position[1], block.position[2]);
        world.add(mesh);
        if (block.blockType === "button") {
          let best = 0;
          let bestD = 1e9;
          next.mechanisms.forEach((m, i) => {
            const c = next.nodes[m.params.controls[0] ?? -1];
            if (!c) return;
            const dx = c.position[0] - block.position[0];
            const dz = c.position[2] - block.position[2];
            const dist = dx * dx + dz * dz;
            if (dist < bestD) {
              bestD = dist;
              best = i;
            }
          });
          mesh.userData.mechIndex = best;
          pickables.push(mesh);
        }
      }
    }

    const goal = next.nodes[next.goalNodeId]!;
    gem = new THREE.Mesh(
      gemGeo,
      new THREE.MeshStandardMaterial({
        color: PALETTE.gold,
        emissive: PALETTE.gold,
        emissiveIntensity: 0.45,
        roughness: 0.28,
      }),
    );
    gem.position.set(goal.position[0], goal.position[1] + 1.55, goal.position[2]);
    gem.castShadow = true;
    world.add(gem);

    const start = next.nodes[next.startNodeId]!;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.32, 0.035, 8, 22),
      matFor(PALETTE.coralDeep, 0.5),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(start.position[0], start.position[1] + 0.03, start.position[2]);
    ring.receiveShadow = true;
    world.add(ring);

    for (const node of next.nodes) {
      const pick = new THREE.Mesh(pickGeo, pickMat);
      pick.userData.nodeId = node.id;
      world.add(pick);
      pickables.push(pick);
      pickByNode[node.id] = pick;

      const marker = new THREE.Mesh(markGeo, markMat);
      marker.castShadow = false;
      world.add(marker);
      markerByNode[node.id] = marker;
    }

    applyMechs();
    syncPicks();
    worldOf(playerNode, vTmp2);
    character.position.set(vTmp2.x, vTmp2.y, vTmp2.z);
    refreshReachable();
    frameLevel();
    emit();
  }

  function syncPicks() {
    for (const node of level.nodes) {
      worldOf(node.id, vTmp2);
      const pick = pickByNode[node.id];
      const marker = markerByNode[node.id];
      if (pick) pick.position.set(vTmp2.x, vTmp2.y + 0.28, vTmp2.z);
      if (marker) marker.position.set(vTmp2.x, vTmp2.y + 0.06, vTmp2.z);
    }
  }

  function controlsOf(nodeId: number): number | null {
    for (let i = 0; i < level.mechanisms.length; i++) {
      if (level.mechanisms[i]!.params.controls.includes(nodeId)) return i;
    }
    return null;
  }

  function canToggle(index: number): boolean {
    return level.mechanisms[index]!.params.controls.includes(playerNode);
  }

  function toggleMech(index: number) {
    if (status !== "play" || walk || mechAnim) return;
    if (!canToggle(index)) {
      say("先站到机关上，再点它。");
      playDeny();
      shake = 0.18;
      return;
    }
    const mech = level.mechanisms[index]!;
    const opts = mech.possibleStates;
    const cur = opts.indexOf(states[index]!);
    const to = opts[(cur + 1) % opts.length]!;
    states[index] = to;
    mech.currentState = to;
    steps += 1;
    mechAnim = {
      index,
      from: visual[index] ?? 0,
      to,
      t: 0,
      dur: reduce ? 0.01 : mech.type === "rotate" ? 0.55 : 0.42,
    };
    playToggle(mech.type);
    const phrase = mechPhrase(mech.type, to);
    say(`${mech.params.label} ${phrase}。`, 1.6);
    refreshReachable();
  }

  function walkTo(nodeId: number) {
    if (status !== "play" || walk || mechAnim) return;
    if (nodeId === playerNode) {
      const mi = controlsOf(nodeId);
      if (mi !== null) toggleMech(mi);
      return;
    }
    const path = findPath(level, playerNode, nodeId, states);
    if (!path || path.length < 2) {
      const node = level.nodes[nodeId];
      if (node?.kind === "illusion") say("这道缝是假的。先拨动旁边的齿轮。");
      else if (node?.kind === "bridge") say("桥还没接到这边。");
      else say("还走不到。");
      playDeny();
      shake = 0.16;
      return;
    }
    const segs: Seg[] = [];
    for (let i = 1; i < path.length; i++) {
      const dest = new THREE.Vector3();
      worldOf(path[i]!, dest);
      const from = new THREE.Vector3();
      if (i === 1) worldOf(path[0]!, from);
      else worldOf(path[i - 1]!, from);
      segs.push({
        to: path[i]!,
        from,
        dest,
        t: 0,
        dur: reduce ? 0.01 : 0.32,
      });
    }
    walk = { segs, i: 0 };
    hidePath();
  }

  function finishHop(to: number) {
    playerNode = to;
    steps += 1;
    const n = level.nodes[to]!;
    playStep(n.position[1]);
    refreshReachable();
    if (to === level.goalNodeId) {
      status = "play";
      walk = null;
      status = "won";
      say("光停在这里。", 4);
      playWin();
      burst();
      refreshReachable();
      emit();
    }
  }

  function load(nextSeed: number, nextDiff: Difficulty) {
    seed = nextSeed;
    difficulty = nextDiff;
    const next = generateLevel({ seed: nextSeed, difficulty: nextDiff });
    build(next);
    say(next.metadata.fallback ? "这座谷走了条备用的路。" : "一座新的谷。", 1.5);
  }

  function reset() {
    level.mechanisms.forEach((m, i) => {
      const s0 = level.metadata.initialStates[i] ?? 0;
      m.currentState = s0;
      states[i] = s0;
      visual[i] = s0;
    });
    playerNode = level.startNodeId;
    steps = 0;
    status = "play";
    walk = null;
    mechAnim = null;
    hintText = null;
    pulseNode = null;
    for (const b of bits) b.mesh.visible = false;
    applyMechs();
    worldOf(playerNode, vTmp2);
    character.position.set(vTmp2.x, vTmp2.y, vTmp2.z);
    refreshReachable();
    say("回到起点。", 1.2);
  }

  function hint() {
    if (status === "won") return;
    // Inline a short lookahead: walk toward the first toggle or the goal.
    const seen = new Set<string>();
    type Rec = { n: number; s: number[]; prev: number; action: "walk" | "toggle"; to: number; mech: number };
    const recs: Rec[] = [];
    const q: number[] = [];
    const push = (n: number, s: number[], prev: number, action: Rec["action"], to: number, mech: number) => {
      const k = `${n}|${s.join(",")}`;
      if (seen.has(k)) return;
      seen.add(k);
      recs.push({ n, s, prev, action, to, mech });
      q.push(recs.length - 1);
    };
    push(playerNode, states.slice(), -1, "walk", playerNode, -1);
    let found = -1;
    let guard = 0;
    while (q.length && guard < 20000) {
      guard++;
      const i = q.shift()!;
      const r = recs[i]!;
      if (r.n === level.goalNodeId) {
        found = i;
        break;
      }
      for (const nxt of neighborsOf(level, r.n, r.s)) {
        push(nxt, r.s, i, "walk", nxt, -1);
      }
      for (let mi = 0; mi < level.mechanisms.length; mi++) {
        if (!level.mechanisms[mi]!.params.controls.includes(r.n)) continue;
        const opts = level.mechanisms[mi]!.possibleStates;
        const cur = opts.indexOf(r.s[mi]!);
        const to = opts[(cur + 1) % opts.length]!;
        const ns = r.s.slice();
        ns[mi] = to;
        push(r.n, ns, i, "toggle", r.n, mi);
      }
    }
    if (found < 0) {
      hintText = "试试把机关拨回去。";
      say(hintText);
      return;
    }
    const actions: Rec[] = [];
    let i = found;
    while (recs[i]!.prev >= 0) {
      actions.push(recs[i]!);
      i = recs[i]!.prev;
    }
    actions.reverse();
    const first = actions[0];
    if (!first) {
      say("你已经在终点。");
      return;
    }
    if (first.action === "toggle") {
      const label = level.mechanisms[first.mech]!.params.label;
      hintText = `点一下「${label}」。`;
      pulseNode = playerNode;
      say(hintText);
      return;
    }
    const hops: number[] = [];
    for (const a of actions) {
      if (a.action !== "walk") break;
      hops.push(a.to);
    }
    pulseNode = hops[hops.length - 1] ?? first.to;
    showPath([playerNode, ...hops]);
    const node = level.nodes[first.to];
    hintText = node?.kind === "illusion" ? "踩上那道发光的接缝。" : "沿着亮起的石阶走。";
    say(hintText);
  }

  function ndc(ev: PointerEvent) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function hit(): { nodeId?: number; mechIndex?: number } | null {
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pickables, false);
    if (!hits.length) return null;
    const o = hits[0]!.object;
    const nodeId = o.userData.nodeId as number | undefined;
    const mechIndex = o.userData.mechIndex as number | undefined;
    return { nodeId, mechIndex };
  }

  function onPointerDown(ev: PointerEvent) {
    unlockAudio();
    dragging = true;
    moved = false;
    downX = ev.clientX;
    downY = ev.clientY;
    renderer.domElement.setPointerCapture(ev.pointerId);
  }
  function onPointerMove(ev: PointerEvent) {
    if (dragging) {
      const dx = ev.clientX - downX;
      const dy = ev.clientY - downY;
      if (!moved && dx * dx + dy * dy > 36) moved = true;
      if (moved) {
        yawTarget = THREE.MathUtils.clamp(yawTarget - ev.movementX * 0.005, -0.7, 0.7);
        pitchTarget = THREE.MathUtils.clamp(pitchTarget - ev.movementY * 0.0035, -0.28, 0.32);
        downX = ev.clientX;
        downY = ev.clientY;
      }
      return;
    }
    ndc(ev);
    const h = hit();
    hoverNode = h?.nodeId ?? null;
    if (hoverNode !== null && reachable.has(hoverNode) && hoverNode !== playerNode && !walk) {
      showPath(findPath(level, playerNode, hoverNode, states));
      renderer.domElement.style.cursor = "pointer";
    } else if (h?.mechIndex !== undefined || (hoverNode !== null && controlsOf(hoverNode) !== null)) {
      hidePath();
      renderer.domElement.style.cursor = "pointer";
    } else {
      hidePath();
      renderer.domElement.style.cursor = "default";
    }
  }
  function onPointerUp(ev: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    if (moved) return;
    ndc(ev);
    const h = hit();
    if (!h) return;
    if (h.mechIndex !== undefined && h.nodeId === undefined) {
      toggleMech(h.mechIndex);
      return;
    }
    if (h.nodeId !== undefined) walkTo(h.nodeId);
  }
  function onPointerLeave() {
    dragging = false;
    hidePath();
  }

  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("pointerleave", onPointerLeave);
  renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());

  const ro = new ResizeObserver(() => {
    frameLevel();
  });
  ro.observe(el);

  for (let i = 0; i < 18; i++) {
    const mesh = new THREE.Mesh(gemGeo, matFor(PALETTE.gold, 0.3));
    mesh.visible = false;
    mesh.scale.setScalar(0.35);
    scene.add(mesh);
    bits.push({ mesh, v: new THREE.Vector3(), life: 0 });
  }

  function update(dt: number) {
    time += dt;
    if (flash && time > flashUntil) {
      flash = null;
      emit();
    }
    shake = Math.max(0, shake - dt);
    const k = 1 - Math.exp(-5.5 * dt);
    yaw += (yawTarget - yaw) * k;
    pitch += (pitchTarget - pitch) * k;
    updateCamera();

    if (mechAnim) {
      mechAnim.t += dt;
      const u = Math.min(1, mechAnim.t / mechAnim.dur);
      visual[mechAnim.index] = mechAnim.from + (mechAnim.to - mechAnim.from) * smooth(u);
      if (u >= 1) mechAnim = null;
    }
    applyMechs();
    syncPicks();

    if (walk) {
      const seg = walk.segs[walk.i]!;
      seg.t += dt;
      const u = Math.min(1, seg.t / seg.dur);
      const e = smooth(u);
      character.position.lerpVectors(seg.from, seg.dest, e);
      character.position.y += Math.sin(u * Math.PI) * 0.08;
      const dx = seg.dest.x - seg.from.x;
      const dz = seg.dest.z - seg.from.z;
      if (dx * dx + dz * dz > 0.0001) {
        const targetYaw = Math.atan2(dx, dz);
        let diff = targetYaw - character.rotation.y;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        character.rotation.y += diff * (1 - Math.exp(-10 * dt));
      }
      if (u >= 1) {
        const arrived = seg.to;
        if (walk.i >= walk.segs.length - 1) {
          walk = null;
          finishHop(arrived);
        } else {
          playerNode = arrived;
          steps += 1;
          playStep(level.nodes[arrived]!.position[1]);
          walk.i += 1;
          refreshReachable();
          emit();
        }
      }
    } else {
      worldOf(playerNode, vTmp2);
      const bob = Math.sin(time * 2.2) * (reduce ? 0 : 0.025);
      character.position.x += (vTmp2.x - character.position.x) * (1 - Math.exp(-12 * dt));
      character.position.z += (vTmp2.z - character.position.z) * (1 - Math.exp(-12 * dt));
      const yTarget = vTmp2.y + bob;
      character.position.y += (yTarget - character.position.y) * (1 - Math.exp(-12 * dt));
    }

    if (gem) {
      const g = level.nodes[level.goalNodeId]!;
      gem.position.y = g.position[1] + 1.55 + Math.sin(time * 1.6) * 0.08;
      gem.rotation.y += dt * 0.7;
    }
    water.position.y = -1.35 + Math.sin(time * 0.6) * 0.04;

    markerByNode.forEach((m, id) => {
      if (!m.visible) return;
      const pulse = pulseNode === id ? 1.55 : 1;
      const s = pulse * (1 + Math.sin(time * 3 + id) * 0.15);
      m.scale.setScalar(s);
    });

    for (const b of bits) {
      if (!b.mesh.visible) continue;
      b.life -= dt * 0.45;
      b.v.y -= dt * 0.8;
      b.mesh.position.addScaledVector(b.v, dt);
      b.mesh.rotation.y += dt;
      if (b.life <= 0) b.mesh.visible = false;
    }
  }

  renderer.setAnimationLoop(() => {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05);
    update(dt);
    renderer.render(scene, camera);
  });

  build(level);

  return {
    dispose() {
      renderer.setAnimationLoop(null);
      timer.disconnect();
      ro.disconnect();
      unbindVis();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      shared.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      pickMat.dispose();
      markMat.dispose();
      pathMat.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      disposeAudio();
    },
    newLevel(opts) {
      const nextSeed =
        opts?.seed ??
        seed;
      const diff = opts?.difficulty ?? difficulty;
      const use =
        opts?.seed === undefined && opts?.difficulty === undefined
          ? Math.floor(Math.random() * 90000) + 1
          : nextSeed;
      load(use, diff);
    },
    reset,
    hint,
    toggleMute() {
      unlockAudio();
      toggleMuted();
      emit();
    },
    togglePeek() {
      const open = Math.abs(yawTarget) < 0.2 && Math.abs(pitchTarget) < 0.08;
      yawTarget = open ? 0.62 : 0;
      pitchTarget = open ? 0.1 : 0;
      say(open ? "侧面看，接缝会散开。" : "回到等距视角。", 1.8);
    },
    exportJson() {
      return JSON.stringify(level, null, 2);
    },
    getSeed: () => seed,
    getDifficulty: () => difficulty,
  };
}
