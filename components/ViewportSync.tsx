"use client";

/**
 * Keep the board and the HUD on the pixels the player can actually see.
 *
 * Android Chrome resizes the visual viewport when the address bar moves or
 * someone pinches. If we ignore that, the dice sit under the dock or the
 * buttons slide off the screen. This writes the live rectangle onto CSS
 * variables and asks the WebGL stage to match it.
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
