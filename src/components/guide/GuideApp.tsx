import { useEffect, useRef } from "react";
import { Overlay } from "./Overlay";
import { useGuide } from "@/lib/guide/store";

export function GuideApp() {
  const hostRef = useRef<HTMLDivElement>(null);
  const ready = useGuide((s) => s.ready);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let dead = false;
    let engine: { dispose: () => void } | null = null;
    void import("@/lib/guide/engine").then(({ GuideEngine }) => {
      if (dead || !hostRef.current) return;
      engine = new GuideEngine(hostRef.current);
      useGuide.getState().setReady(true);
    });
    return () => {
      dead = true;
      engine?.dispose();
      useGuide.getState().setReady(false);
    };
  }, ["mode-snap"]);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-bg">
      <div ref={hostRef} className="absolute inset-0" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="font-mono text-2xs uppercase tracking-[0.28em] text-muted">
            Loading airframe
          </p>
        </div>
      )}
      <Overlay />
    </main>
  );
}
