"use client";

/**
 * Tell the renderer when the visible screen changes.
 *
 * Address bar show/hide and turning the phone all change the real pixels.
 * The menus themselves stay in ordinary document flow so Safari cannot
 * hide them behind the dice.
 */

import { useEffect } from "react";
import { syncViewportCss } from "@/lib/viewport";

export function ViewportSync() {
  useEffect(() => {
    const apply = () => {
      syncViewportCss();
      window.dispatchEvent(new Event("fd3-viewport"));
    };
    apply();
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    window.visualViewport?.addEventListener("resize", apply);
    window.visualViewport?.addEventListener("scroll", apply);
    return () => {
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
      window.visualViewport?.removeEventListener("resize", apply);
      window.visualViewport?.removeEventListener("scroll", apply);
    };
  }, []);
  return null;
}
