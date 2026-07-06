/**
 * City backdrops shown behind the buildings (a distant horizon silhouette).
 * Pure data; the renderer (src/render/renderer.ts) draws each one.
 */
export interface Background {
  id: string;
  name: string;
}

export const BACKGROUNDS: Background[] = [
  { id: "skyline", name: "City Skyline" },
  { id: "mountains", name: "Mountain Range" },
  { id: "palms", name: "Palm Coast" },
  { id: "hills", name: "Rolling Hills" },
  { id: "clear", name: "Open Sky" },
];

export const DEFAULT_BACKGROUND = "skyline";

export function isBackground(id: string): boolean {
  return BACKGROUNDS.some((b) => b.id === id);
}
