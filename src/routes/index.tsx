import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ComponentType } from "react";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const [App, setApp] = useState<ComponentType | null>(null);
  useEffect(() => {
    let dead = false;
    void import("@/components/vale-app").then((m) => {
      if (!dead) setApp(() => m.ValeApp);
    });
    return () => {
      dead = true;
    };
  }, []);

  if (!App) {
    return (
      <main className="flex h-dvh items-center justify-center bg-dawn">
        <h1 className="font-display text-5xl text-ink">镜阶</h1>
      </main>
    );
  }
  return <App />;
}
