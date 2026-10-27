import { useEffect, useRef, useState } from "react";
import { Eye, Lightbulb, RotateCcw, ScrollText, Sprout, Volume2, VolumeX } from "lucide-react";
import { mountGame, type GameHandle, type HudState } from "@/game/scene";
import type { Difficulty, LevelMetadata } from "@/game/types";

const SAVE_KEY = "jingjie-v1";

const EMPTY_META: LevelMetadata = {
  seed: 42,
  difficulty: "medium",
  solvable: true,
  shortestSteps: 0,
  stateSpace: 0,
  mechanismCount: 0,
  illusionCount: 0,
  nodeCount: 0,
  edgeCount: 0,
  aha: [],
  initialStates: [],
  generator: "backward-construction",
  attempts: 1,
  fallback: false,
};

const INITIAL: HudState = {
  seed: 42,
  difficulty: "medium",
  steps: 0,
  status: "play",
  mechs: [],
  metrics: EMPTY_META,
  flash: null,
  muted: false,
  peeking: false,
  hint: null,
};

function readSave(): { seed: number; difficulty: Difficulty; muted: boolean } {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { seed: 42, difficulty: "medium", muted: false };
    const parsed = JSON.parse(raw) as { seed?: number; difficulty?: Difficulty; muted?: boolean };
    const difficulty =
      parsed.difficulty === "easy" || parsed.difficulty === "hard" || parsed.difficulty === "medium"
        ? parsed.difficulty
        : "medium";
    const seed = Number.isFinite(parsed.seed) ? Math.max(1, Math.floor(parsed.seed!)) : 42;
    return { seed, difficulty, muted: Boolean(parsed.muted) };
  } catch {
    return { seed: 42, difficulty: "medium", muted: false };
  }
}

const DIFFS: { id: Difficulty; label: string }[] = [
  { id: "easy", label: "易" },
  { id: "medium", label: "中" },
  { id: "hard", label: "难" },
];

export function ValeApp() {
  const mountRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<GameHandle | null>(null);
  const savedOnce = readSave();
  const [hud, setHud] = useState<HudState>({
    ...INITIAL,
    seed: savedOnce.seed,
    difficulty: savedOnce.difficulty,
    muted: savedOnce.muted,
    metrics: { ...EMPTY_META, seed: savedOnce.seed, difficulty: savedOnce.difficulty },
  });
  const [intro, setIntro] = useState(() => sessionStorage.getItem("jingjie-entered") !== "1");
  const [archive, setArchive] = useState(false);
  const [json, setJson] = useState("");
    const [seedText, setSeedText] = useState(String(savedOnce.seed));
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const saved = readSave();
    setSeedText(String(saved.seed));
    setIntro(sessionStorage.getItem("jingjie-entered") !== "1");
    const api = mountGame(el, setHud, { seed: saved.seed, difficulty: saved.difficulty });
    if (saved.muted) api.toggleMute();
    apiRef.current = api;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "h" || e.key === "H") api.hint();
      if (e.key === "v" || e.key === "V") api.togglePeek();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      api.dispose();
      apiRef.current = null;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({ version: 1, seed: hud.seed, difficulty: hud.difficulty, muted: hud.muted }),
    );
  }, [hud.seed, hud.difficulty, hud.muted]);

  useEffect(() => {
    setSeedText(String(hud.seed));
  }, [hud.seed]);

  const openArchive = () => {
    const text = apiRef.current?.exportJson() ?? "";
    setJson(text);
    setArchive(true);
    setCopied(false);
  };

  const applySeed = () => {
    const n = Math.max(1, Math.floor(Number(seedText)));
    if (!Number.isFinite(n)) return;
    setSeedText(String(n));
    apiRef.current?.newLevel({ seed: n, difficulty: hud.difficulty });
    setArchive(false);
  };

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-dawn text-ink">
      <div ref={mountRef} className="absolute inset-0" />

      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3 sm:p-5">
        <header className="flex items-start justify-between gap-2">
          <div className="pointer-events-auto min-w-0 flex-1 rounded-2xl border border-line bg-cream px-4 py-3">
            <p className="font-display text-3xl leading-none text-balance">镜阶</p>
            <p className="mt-1 text-xs text-muted">
              种子 <span className="tabular-nums text-ink">{hud.seed}</span>
              <span className="mx-1.5">·</span>
              {hud.metrics.solvable ? "可解" : "未验证"}
              <span className="mx-1.5">·</span>
              最短 <span className="tabular-nums">{Math.max(0, hud.metrics.shortestSteps)}</span> 步
            </p>
            {hud.mechs.length > 0 && (
              <p className="mt-2 max-w-xs text-xs leading-relaxed text-muted">
                {hud.mechs.map((m) => `${m.label} ${m.state ? "开" : "合"}`).join("  ·  ")}
              </p>
            )}
          </div>
          <div className="pointer-events-auto flex items-center gap-2">
            <div className="rounded-2xl border border-line bg-cream px-3 py-2">
              <p className="text-xs text-muted">步数</p>
              <p className="font-display text-2xl leading-none tabular-nums">{hud.steps}</p>
            </div>
            <button
              type="button"
              aria-label={hud.muted ? "打开声音" : "关闭声音"}
              className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-line bg-cream"
              onClick={() => apiRef.current?.toggleMute()}
            >
              {hud.muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
            </button>
          </div>
        </header>

        <div className="flex flex-col items-center gap-2">
          {hud.flash && (
            <p className="max-w-sm rounded-full bg-ink px-4 py-2 text-center text-sm text-cream text-balance">
              {hud.flash}
            </p>
          )}
          <footer className="pointer-events-auto flex w-full max-w-3xl flex-col gap-2 rounded-2xl border border-line bg-cream p-2 sm:p-3">
            <div className="flex items-center gap-2 overflow-x-auto">
              <div className="flex shrink-0 rounded-full bg-dawn p-1" role="group" aria-label="难度">
                {DIFFS.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className={
                      "min-h-11 min-w-11 rounded-full px-3 text-sm " +
                      (hud.difficulty === d.id ? "bg-ink text-cream" : "text-muted")
                    }
                    onClick={() => apiRef.current?.newLevel({ seed: hud.seed, difficulty: d.id })}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <label className="flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-dawn px-3 text-sm">
                <span className="text-muted">种子</span>
                <input
                  value={seedText}
                  inputMode="numeric"
                  aria-label="种子"
                  className="w-16 bg-transparent tabular-nums outline-none"
                  onChange={(e) => setSeedText(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") applySeed();
                  }}
                />
              </label>
              <button
                type="button"
                className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-coral px-4 text-sm text-cream"
                onClick={() => {
                  apiRef.current?.newLevel();
                  setArchive(false);
                }}
              >
                <Sprout className="size-4" />
                新的一座
              </button>
              <button
                type="button"
                className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm"
                onClick={() => apiRef.current?.reset()}
              >
                <RotateCcw className="size-4" />
                重走
              </button>
              <button
                type="button"
                className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm"
                onClick={() => apiRef.current?.hint()}
              >
                <Lightbulb className="size-4" />
                提示
              </button>
              <button
                type="button"
                className={
                  "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm " +
                  (hud.peeking ? "bg-ink text-cream" : "")
                }
                onClick={() => apiRef.current?.togglePeek()}
              >
                <Eye className="size-4" />
                {hud.peeking ? "复位" : "窥视"}
              </button>
              <button
                type="button"
                className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm"
                onClick={() => (archive ? setArchive(false) : openArchive())}
              >
                <ScrollText className="size-4" />
                档案
              </button>
            </div>
            <p className="px-2 text-xs text-muted text-pretty">
              点石阶行走。站上机关再点它，路会改口。拖动或点「窥视」，假缝会散开。
            </p>
          </footer>
        </div>
      </div>

      {archive && (
        <section className="absolute inset-x-3 top-24 bottom-36 z-10 overflow-auto rounded-2xl border border-line bg-cream p-4 sm:inset-x-auto sm:right-5 sm:w-96">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-display text-2xl">关卡档案</h2>
            <button type="button" className="text-sm text-muted" onClick={() => setArchive(false)}>
              关闭
            </button>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl bg-dawn px-3 py-2">
              <dt className="text-xs text-muted">状态空间</dt>
              <dd className="tabular-nums">{hud.metrics.stateSpace}</dd>
            </div>
            <div className="rounded-xl bg-dawn px-3 py-2">
              <dt className="text-xs text-muted">视错觉</dt>
              <dd className="tabular-nums">{hud.metrics.illusionCount}</dd>
            </div>
            <div className="rounded-xl bg-dawn px-3 py-2">
              <dt className="text-xs text-muted">机关</dt>
              <dd className="tabular-nums">{hud.metrics.mechanismCount}</dd>
            </div>
            <div className="rounded-xl bg-dawn px-3 py-2">
              <dt className="text-xs text-muted">节点</dt>
              <dd className="tabular-nums">{hud.metrics.nodeCount}</dd>
            </div>
          </dl>
          <ul className="mt-3 space-y-2 text-sm text-pretty">
            {hud.metrics.aha.map((line) => (
              <li key={line} className="border-l-2 border-coral pl-3 text-ink">
                {line}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="min-h-11 rounded-full bg-ink px-4 text-sm text-cream" onClick={applySeed}>
              用此种子生成
            </button>
            <button
              type="button"
              className="min-h-11 rounded-full border border-line px-4 text-sm"
              onClick={() => {
                void navigator.clipboard?.writeText(json);
                setCopied(true);
              }}
            >
              {copied ? "已复制" : "复制 JSON"}
            </button>
            <button
              type="button"
              className="min-h-11 rounded-full border border-line px-4 text-sm"
              onClick={() => {
                const blob = new Blob([json], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `jingjie-${hud.seed}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              下载
            </button>
          </div>
          <pre className="mt-3 max-h-48 overflow-auto rounded-xl bg-dawn p-3 text-xs leading-relaxed text-pretty">
            {json}
          </pre>
        </section>
      )}

      {intro && (
        <div className="absolute inset-0 z-20 flex items-end justify-center bg-ink/20 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl border border-line bg-cream p-6 sm:p-8">
            <p className="text-xs tracking-widest text-coral">AN IMPOSSIBLE WALK</p>
            <h1 className="mt-2 font-display text-5xl text-balance">镜阶</h1>
            <p className="mt-4 text-pretty leading-relaxed text-muted">
              每座谷都是刚刚长出来的。有的台阶在等距视角里连在一起，转开身子就会看见缝。先保证能走到头，再让你自己找那一下。
            </p>
            <button
              type="button"
              className="mt-6 min-h-11 w-full rounded-full bg-coral text-cream"
              onClick={() => {
                sessionStorage.setItem("jingjie-entered", "1");
                setIntro(false);
              }}
            >
              踏入
            </button>
          </div>
        </div>
      )}

      {hud.status === "won" && !intro && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-end justify-center p-4 sm:items-center">
          <div className="pointer-events-auto w-full max-w-sm rounded-2xl border border-line bg-cream p-6 text-center">
            <p className="text-xs tracking-widest text-gold">ARRIVED</p>
            <h2 className="mt-1 font-display text-4xl text-balance">你走到了光里</h2>
            <p className="mt-3 text-sm text-muted">
              这一座用了 <span className="tabular-nums text-ink">{hud.steps}</span> 步。最短记录是{" "}
              <span className="tabular-nums text-ink">{hud.metrics.shortestSteps}</span> 步。种子{" "}
              <span className="tabular-nums text-ink">{hud.seed}</span>。
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                className="min-h-11 flex-1 rounded-full bg-coral text-sm text-cream"
                onClick={() => apiRef.current?.newLevel()}
              >
                再走一座
              </button>
              <button
                type="button"
                className="min-h-11 flex-1 rounded-full border border-line text-sm"
                onClick={() => apiRef.current?.reset()}
              >
                重走这座
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
