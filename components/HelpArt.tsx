"use client";

import { useEffect, useRef } from "react";
import { addHullPath } from "@/components/HullShape";
import { hullForFace } from "@/lib/reference";
import { faceSpec, flagFaceSpec, paintHelpFace } from "@/lib/three/faceArt";
import { displayFontFamily, waitForFonts } from "@/lib/three/fonts";
import type { DieSize } from "@/lib/engine";

function HelpCanvas({
  value,
  role,
  size,
  className,
}: {
  value: number;
  role: "ship" | "flag";
  size: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hull: DieSize = role === "flag" ? 6 : hullForFace(value);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const spec = role === "flag" ? flagFaceSpec(value) : faceSpec(value);
    const font = displayFontFamily();
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      addHullPath(ctx, hull, size);
      ctx.clip();
      paintHelpFace(ctx, spec, hull, size, font);
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(255,255,255,0.32)";
      ctx.lineWidth = Math.max(1.2, size * 0.028);
      addHullPath(ctx, hull, size);
      ctx.stroke();
      ctx.restore();
    };
    draw();
    void waitForFonts().then(draw);
  }, [value, role, size, hull]);

  return (
    <canvas
      ref={ref}
      className={className ?? `help-face help-face-d${hull}`}
      aria-hidden
    />
  );
}

export function HelpShipFace({
  value,
  size = 72,
  className,
}: {
  value: number;
  size?: number;
  className?: string;
}) {
  return <HelpCanvas value={value} role="ship" size={size} className={className} />;
}

export function HelpFlagFace({
  face,
  size = 72,
  className,
}: {
  face: number;
  size?: number;
  className?: string;
}) {
  return <HelpCanvas value={face} role="flag" size={size} className={className} />;
}
