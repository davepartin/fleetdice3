"use client";

import { useEffect, useRef } from "react";
import { faceSpec, flagFaceSpec, paintHelpFace } from "@/lib/three/faceArt";
import { displayFontFamily, waitForFonts } from "@/lib/three/fonts";

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
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const spec = role === "flag" ? flagFaceSpec(value) : faceSpec(value);
    const font = displayFontFamily();
    const draw = () => paintHelpFace(ctx, spec, 6, size, font);
    draw();
    void waitForFonts().then(draw);
  }, [value, role, size]);

  return <canvas ref={ref} className={className ?? "help-face"} aria-hidden />;
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
