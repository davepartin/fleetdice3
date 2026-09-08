"use client";
import { useEffect } from "react";
import { notePlaytest } from "@/lib/playtest";

export function PlaytestDiagnostics() {
  useEffect(() => {
    // Record categories only: raw errors/URLs can contain private room links.
    const error = () => notePlaytest("browser-error");
    const rejected = () => notePlaytest("unhandled-operation");
    const online = () => notePlaytest("network-restored");
    const offline = () => notePlaytest("network-lost");
    window.addEventListener("error", error);
    window.addEventListener("unhandledrejection", rejected);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("error", error);
      window.removeEventListener("unhandledrejection", rejected);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, []);
  return null;
}
