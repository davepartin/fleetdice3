"use client";

import { useEffect, useRef } from "react";
import { addHullPath } from "@/components/HullShape";
import { hullForFace } from "@/lib/reference";
import { faceSpec, flagFaceSpec, paintHelpFace, paintHullPlate } from "@/lib/three/faceArt";
import { displayFontFamily, numeralFontFamily, waitForFonts } from "@/lib/three/fonts";
import type { DieSize } from "@/lib/engine";

function HelpCanvas({
  value,
  role,
  size,
  hull: hullOverride,
  className,
}: {
  value: number;
  role: "ship" | "flag";
  size: number;
  /**
   * The hull to clip to. Help screens leave this out: there, a face is an
   * example of a number, so it is drawn on the smallest hull that shows it.
   * Anywhere a face belongs to a *real* ship — the battle recap — pass the
   * ship's own hull, or a 4 rolled on a d10 draws as a triangle.
   */
  hull?: DieSize;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hull: DieSize = hullOverride ?? (role === "flag" ? 6 : hullForFace(value));

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
    const captionFont = displayFontFamily();
    const numeralFont = numeralFontFamily();
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      addHullPath(ctx, hull, size);
      ctx.clip();
      paintHelpFace(ctx, spec, hull, size, numeralFont, captionFont);
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
  hull,
  className,
}: {
  value: number;
  size?: number;
  hull?: DieSize;
  className?: string;
}) {
  return <HelpCanvas value={value} role="ship" size={size} hull={hull} className={className} />;
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

/**
 * A hull that spent the round out, drawn with the very same plate the board and
 * the block screen use: its silhouette, its size, a red bar through it.
 *
 * One mark, one meaning — a ship sitting a round out looks the same wherever it
 * is drawn, so the recap never invents a second way to say it.
 */
export function HelpHullPlate({
  sides,
  size = 40,
  variant = "spent",
  className,
}: {
  sides: DieSize;
  size?: number;
  variant?: "idle" | "spent";
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2);
    const px = Math.round(size * dpr);
    canvas.width = px;
    canvas.height = px;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const draw = () => {
      ctx.clearRect(0, 0, px, px);
      ctx.drawImage(paintHullPlate(sides, px, numeralFontFamily(), variant), 0, 0);
    };
    draw();
    void waitForFonts().then(draw);
  }, [sides, size, variant]);

  return <canvas ref={ref} className={className} aria-hidden />;
}
