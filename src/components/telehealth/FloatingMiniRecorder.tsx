import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { Pause, Play, Square, Maximize2, GripVertical, PictureInPicture2, X, Mic } from "lucide-react";
import { cn } from "@/lib/utils";

interface FloatingMiniRecorderProps {
  isPaused: boolean;
  duration: number;
  audioLevel: number; // 0..1
  patientName?: string;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onExpand: () => void;
  onClose?: () => void;
}

function formatDuration(s: number) {
  const h = Math.floor(s / 3600).toString().padStart(2, "0");
  const m = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

export default function FloatingMiniRecorder(props: FloatingMiniRecorderProps) {
  const { isPaused, duration, audioLevel, patientName, onPause, onResume, onStop, onExpand, onClose } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const pipWindowRef = useRef<Window | null>(null);
  const pipMountRef = useRef<HTMLDivElement | null>(null);
  const [pipActive, setPipActive] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>(() => ({
    x: typeof window !== "undefined" ? window.innerWidth - 280 : 20,
    y: 80,
  }));
  const dragging = useRef<{ dx: number; dy: number } | null>(null);

  // Drag handlers
  const onPointerDown = (e: React.PointerEvent) => {
    if (pipActive) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragging.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const x = Math.max(0, Math.min(window.innerWidth - 260, e.clientX - dragging.current.dx));
    const y = Math.max(0, Math.min(window.innerHeight - 80, e.clientY - dragging.current.dy));
    setPos({ x, y });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    dragging.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
  };

  // Picture-in-Picture (Document PiP) — flutua por cima de Zoom/Meet
  const supportsDocPip = typeof window !== "undefined" && "documentPictureInPicture" in window;

  const openPip = useCallback(async () => {
    if (!supportsDocPip) return;
    try {
      // @ts-expect-error - experimental API
      const pipWin: Window = await window.documentPictureInPicture.requestWindow({
        width: 280,
        height: 130,
      });
      pipWindowRef.current = pipWin;

      // Copia os estilos para a janela PiP
      [...document.styleSheets].forEach((sheet) => {
        try {
          const css = [...(sheet.cssRules as any)].map((r: any) => r.cssText).join("");
          const style = pipWin.document.createElement("style");
          style.textContent = css;
          pipWin.document.head.appendChild(style);
        } catch {
          if (sheet.href) {
            const link = pipWin.document.createElement("link");
            link.rel = "stylesheet";
            link.href = sheet.href;
            pipWin.document.head.appendChild(link);
          }
        }
      });

      pipWin.document.body.style.margin = "0";
      pipWin.document.body.style.background = "transparent";
      const mount = pipWin.document.createElement("div");
      pipWin.document.body.appendChild(mount);
      pipMountRef.current = mount;
      setPipActive(true);

      pipWin.addEventListener("pagehide", () => {
        pipMountRef.current = null;
        pipWindowRef.current = null;
        setPipActive(false);
      });
    } catch (err) {
      console.error("PiP failed", err);
    }
  }, [supportsDocPip]);

  const closePip = () => {
    pipWindowRef.current?.close();
    pipMountRef.current = null;
    pipWindowRef.current = null;
    setPipActive(false);
  };

  useEffect(() => () => { pipWindowRef.current?.close(); }, []);

  const levelBars = Array.from({ length: 18 });
  const lvl = Math.max(0, Math.min(1, audioLevel));

  const widget = (
    <div
      ref={containerRef}
      style={pipActive ? { position: "relative" } : { position: "fixed", left: pos.x, top: pos.y, zIndex: 9999 }}
      className={cn(
        "w-[260px] select-none rounded-2xl border bg-card shadow-2xl",
        "border-border/60 backdrop-blur",
        isPaused ? "ring-2 ring-warning/40" : "ring-2 ring-destructive/30"
      )}
    >
      {/* Header / drag handle */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className={cn(
          "flex items-center justify-between px-3 py-2 border-b border-border/50 rounded-t-2xl",
          !pipActive && "cursor-grab active:cursor-grabbing"
        )}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {!pipActive && <GripVertical className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
          <Mic className={cn("h-3.5 w-3.5 shrink-0", isPaused ? "text-warning" : "text-destructive animate-pulse")} />
          <span className="text-[11px] font-medium text-foreground truncate">
            {patientName || "Gravando sessão"}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          {supportsDocPip && !pipActive && (
            <button
              onClick={openPip}
              title="Abrir janela flutuante sobre Zoom/Meet"
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
            >
              <PictureInPicture2 className="h-3.5 w-3.5" />
            </button>
          )}
          {pipActive && (
            <button onClick={closePip} title="Fechar PiP" className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={onExpand}
            title="Expandir"
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="px-3 py-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <span className={cn("font-mono text-base font-semibold tabular-nums", isPaused ? "text-warning" : "text-destructive")}>
            {formatDuration(duration)}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {isPaused ? "Pausado" : "Gravando"}
          </span>
        </div>

        {/* Live level meter */}
        <div className="flex items-center justify-between gap-[2px] h-5">
          {levelBars.map((_, i) => {
            const threshold = (i + 1) / levelBars.length;
            const active = !isPaused && lvl >= threshold * 0.6;
            const h = isPaused ? 3 : Math.max(3, lvl * 20 * (0.4 + Math.sin((i + Date.now() / 120) * 0.6) * 0.4 + 0.6));
            return (
              <div
                key={i}
                style={{ height: h }}
                className={cn(
                  "w-[3px] rounded-full transition-colors",
                  active ? "bg-destructive" : "bg-muted-foreground/30"
                )}
              />
            );
          })}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1.5 pt-1">
          {isPaused ? (
            <button
              onClick={onResume}
              className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90"
            >
              <Play className="h-3.5 w-3.5" /> Continuar
            </button>
          ) : (
            <button
              onClick={onPause}
              className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-muted text-foreground text-xs font-medium hover:bg-muted/80"
            >
              <Pause className="h-3.5 w-3.5" /> Pausar
            </button>
          )}
          <button
            onClick={onStop}
            className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-destructive text-destructive-foreground text-xs font-medium hover:opacity-90"
          >
            <Square className="h-3.5 w-3.5" /> Finalizar
          </button>
        </div>
      </div>
    </div>
  );

  if (pipActive && pipMountRef.current) {
    return createPortal(widget, pipMountRef.current);
  }
  return widget;
}
