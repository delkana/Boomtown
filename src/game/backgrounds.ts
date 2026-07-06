/**
 * City backdrops shown behind the buildings. Two independent layers combine to
 * make a scene: a FAR layer on the horizon (ocean / mountains / hills / open
 * sky) and a NEAR layer closer in (a skyline, historic rooftops, palms, firs, or
 * nothing). Pure data; the renderer (src/render/renderer.ts) draws each one with
 * its own parallax and haze.
 */
export interface Background {
  id: string;
  name: string;
}

/** Distant horizon layer (drawn first, hazier, slow parallax). */
export const FAR_BACKGROUNDS: Background[] = [
  { id: "clear", name: "Open Sky" },
  { id: "mountains", name: "Mountains" },
  { id: "hills", name: "Rolling Hills" },
  { id: "ocean", name: "Ocean Horizon" },
];

/** Nearer layer just behind the towers (drawn second, darker, faster parallax). */
export const NEAR_BACKGROUNDS: Background[] = [
  { id: "none", name: "None" },
  { id: "skyline", name: "Highrises" },
  { id: "oldtown", name: "Historic Quarter" },
  { id: "palms", name: "Palm Trees" },
  { id: "firs", name: "Fir Forest" },
];

export const DEFAULT_FAR = "mountains";
export const DEFAULT_NEAR = "skyline";

export function isFarBackground(id: string): boolean {
  return FAR_BACKGROUNDS.some((b) => b.id === id);
}
export function isNearBackground(id: string): boolean {
  return NEAR_BACKGROUNDS.some((b) => b.id === id);
}

/**
 * Migrate a legacy single-layer `background` id (from before the near/far split)
 * into a near+far pair, so old saves and old snapshots still render sensibly.
 */
export function migrateBackground(old: string | undefined): { near: string; far: string } {
  switch (old) {
    case "mountains":
      return { near: "none", far: "mountains" };
    case "hills":
      return { near: "none", far: "hills" };
    case "palms":
      return { near: "palms", far: "ocean" };
    case "skyline":
      return { near: "skyline", far: "clear" };
    case "clear":
      return { near: "none", far: "clear" };
    default:
      return { near: DEFAULT_NEAR, far: DEFAULT_FAR };
  }
}
