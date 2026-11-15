"use client";

import React,{ useState,useEffect,useCallback,useRef } from "react";

interface HoldToConfirmButtonProps {
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
  pending?: boolean;
  durationMs?: number;
  variant?: "danger" | "warning";
  className?: string;
  "data-testid"?: string;
  children: React.ReactNode;
  holdLabel?: string;
}

export function HoldToConfirmButton({
  onConfirm,
  disabled = false,
  pending = false,
  durationMs = 1500,
  variant = "danger",
  className = "",
  "data-testid": testId,
  children,
  holdLabel,
}: HoldToConfirmButtonProps) {
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showHint, setShowHint] = useState(false);
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const completedRef = useRef(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const cancelHold = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    startTimeRef.current = null;
    if (buttonRef.current) {
      buttonRef.current.style.removeProperty("--vibe");
      buttonRef.current.style.transform = "";
    }
    setHolding(false);
    setProgress(0);
  }, []);

  const handleStart = useCallback(
    () => {
      if (disabled || pending || completedRef.current) return;
      setHolding(true);
      setShowHint(false);
      setProgress(0);
      startTimeRef.current = performance.now();

      const frame = () => {
        if (!startTimeRef.current) return;
        const elapsed = performance.now() - startTimeRef.current;
        const pct = Math.min(100, (elapsed / durationMs) * 100);
        setProgress(pct);

        const vibeRatio = pct / 100;
        if (buttonRef.current) {
          buttonRef.current.style.setProperty("--vibe", vibeRatio.toFixed(3));
          if (pct > 0) {
            // Nonlinear curve: no vibration at start, escalating smoothly to maximum vibration at 100%
            const curve = Math.pow(vibeRatio, 1.35);
            const maxShift = 3.8; // px
            const maxRot = 1.6; // deg
            const rx = (Math.random() * 2 - 1) * maxShift * curve;
            const ry = (Math.random() * 2 - 1) * maxShift * curve;
            const rdeg = (Math.random() * 2 - 1) * maxRot * curve;
            buttonRef.current.style.transform = `translate3d(${rx.toFixed(2)}px, ${ry.toFixed(2)}px, 0) rotate(${rdeg.toFixed(2)}deg)`;
          } else {
            buttonRef.current.style.transform = "";
          }
        }

        if (pct >= 100) {
          completedRef.current = true;
          if (buttonRef.current) {
            buttonRef.current.style.removeProperty("--vibe");
            buttonRef.current.style.transform = "";
          }
          setHolding(false);
          setProgress(100);
          onConfirm();
          setTimeout(() => {
            completedRef.current = false;
            setProgress(0);
          }, 800);
        } else {
          rafRef.current = requestAnimationFrame(frame);
        }
      };

      rafRef.current = requestAnimationFrame(frame);
    },
    [disabled, pending, durationMs, onConfirm]
  );

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (disabled || pending) return;
    if (!completedRef.current && progress < 100) {
      setShowHint(true);
      setTimeout(() => setShowHint(false), 2000);
    }
  };

  const baseTheme =
    variant === "danger"
      ? "bg-red-600 hover:bg-red-700 active:bg-red-800 text-white border border-red-700 dark:border-red-500 shadow-sm shadow-red-600/30"
      : "bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white border border-amber-700 dark:border-amber-500 shadow-sm shadow-amber-600/30";

  return (
    <div className="relative inline-flex flex-col items-center">
      <button
        ref={buttonRef}
        type="button"
        data-testid={testId}
        disabled={disabled || pending}
        onPointerDown={handleStart}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onPointerCancel={cancelHold}
        onKeyDown={(e) => {
          if ((e.key === " " || e.key === "Enter") && !holding) {
            handleStart();
          }
        }}
        onKeyUp={(e) => {
          if (e.key === " " || e.key === "Enter") {
            cancelHold();
          }
        }}
        onClick={handleClick}
        className={`relative overflow-hidden select-none transition disabled:opacity-50 disabled:cursor-not-allowed ${baseTheme} ${
          holding ? "animate-hold-vibrate" : ""
        } ${className}`}
        style={{
          boxShadow:
            holding && variant === "danger"
              ? `0 0 ${Math.round((progress / 100) * 16)}px rgba(220, 38, 38, ${0.4 + (progress / 100) * 0.4}), inset 0 0 ${Math.round((progress / 100) * 8)}px rgba(153, 27, 27, 0.6)`
              : undefined,
        }}
      >
        {/* Fill progress layer */}
        <span
          className={`absolute inset-y-0 left-0 pointer-events-none transition-[width] ease-linear border-r-2 border-white/95 ${
            variant === "danger"
              ? "bg-red-950/50 dark:bg-black/50"
              : "bg-amber-950/50 dark:bg-black/50"
          }`}
          style={{
            width: `${progress}%`,
            transitionDuration: holding ? "40ms" : "150ms",
          }}
        />

        {/* Button Content */}
        <span className="relative z-10 flex items-center justify-center gap-1.5 font-semibold">
          {pending ? (
            "Processing..."
          ) : holding ? (
            <>
              <span>{holdLabel || "Hold to confirm..."}</span>
              <span className="text-[10px] font-mono font-bold">{Math.round(progress)}%</span>
            </>
          ) : (
            children
          )}
        </span>
      </button>

      {showHint && !disabled && (
        <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium text-red-500 dark:text-red-400 animate-pulse">
          Press and hold for 1.5s to confirm
        </span>
      )}
    </div>
  );
}
