"use client";
import { useEffect, useState } from "react";
import { audio, type CueName } from "@/lib/audio";
import { reducedMotion, setMotionStyle } from "@/lib/presentation";
import { Button, Sheet } from "./ui";

export function SoundSettings({ open, onClose }: { open: boolean; onClose(): void }) {
  const [effects, setEffects] = useState(1), [ambience, setAmbience] = useState(1), [quietMotion, setQuietMotion] = useState(false);
  useEffect(() => { if (open) { setEffects(audio.effectsVolume); setAmbience(audio.ambienceVolume); setQuietMotion(reducedMotion()); } }, [open]);
  const preview = (cue: CueName) => { audio.unlock(); audio.setMuted(false); audio.play(cue); };
  return <Sheet open={open} onClose={onClose} title="Sound & motion">
    <div className="sound-settings">
      <label>Sound effects <span>{Math.round(effects * 100)}%</span><input aria-label="Sound effects volume" type="range" min="0" max="1" step="0.05" value={effects} onChange={e => { const v = Number(e.target.value); setEffects(v); audio.setEffectsVolume(v); }} /></label>
      <label>Ambience <span>{Math.round(ambience * 100)}%</span><input aria-label="Ambience volume" type="range" min="0" max="1" step="0.05" value={ambience} onChange={e => { const v = Number(e.target.value); setAmbience(v); audio.setAmbienceVolume(v); }} /></label>
      <label className="motion-choice"><input type="checkbox" checked={quietMotion} onChange={e => { setQuietMotion(e.target.checked); setMotionStyle(e.target.checked ? "reduced" : "full"); }} />Gentle motion · quick rolls, no camera shake</label>
      <p className="text-sm c-dim">Try the sounds on your phone. A preview turns sound on. Your device’s reduced-motion preference is always respected.</p>
      <div className="grid grid-cols-2 gap-2">
        {([["dice-land", "Dice landing"], ["shield-block", "Shields"], ["direct-hit", "Direct hit"], ["formation-row", "Formation"]] as [CueName, string][]).map(([cue, label]) => <Button key={cue} tone="ghost" onClick={() => preview(cue)}>{label}</Button>)}
      </div>
    </div>
  </Sheet>;
}
