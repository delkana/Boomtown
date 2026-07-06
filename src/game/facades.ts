/**
 * Facade styles — a purely cosmetic look applied to a girder, which then drives
 * how the girder itself is drawn AND the wall material + window pattern of any
 * room built on top of it. Stored on each girder (so all clients agree) but has
 * zero effect on the simulation/economy.
 *
 * Pure data (colour strings + a pattern tag); the renderer interprets it.
 */
export type FacadePattern = "full" | "rect" | "vrect" | "vgrid" | "xbrace" | "arch";

export interface Facade {
  id: string;
  name: string;
  /** Facade wall material colour (the solid part between windows). */
  wall: string;
  /** Window frame / mullion colour (also used for X-bracing). */
  frame: string;
  /** Base colour of the bare structural girder in this style. */
  girder: string;
  /** How the windows are laid out on the wall. */
  pattern: FacadePattern;
  /** 0..1 darkening applied to the (transparent) glass, e.g. tinted glass. */
  tint?: number;
  /** Draw brick coursing on the wall. */
  brick?: boolean;
}

export const FACADES: Facade[] = [
  { id: "glass", name: "Full Glass", wall: "#2b333d", frame: "#cdd8e2", girder: "#7c8fa0", pattern: "full" },
  { id: "blacktint", name: "Black Tinted", wall: "#131519", frame: "#2c3138", girder: "#24272d", pattern: "full", tint: 0.5 },
  { id: "concrete", name: "Concrete", wall: "#8b8f94", frame: "#65696e", girder: "#9a9ea3", pattern: "rect" },
  { id: "brick", name: "Brick", wall: "#8f4a39", frame: "#d8ccba", girder: "#8a4636", pattern: "vrect", brick: true },
  { id: "xbrace", name: "Glass X-Brace", wall: "#28303a", frame: "#b9c3cd", girder: "#6f7d8a", pattern: "xbrace" },
  { id: "curtain", name: "Curtain Wall", wall: "#39424c", frame: "#aeb9c4", girder: "#8892a1", pattern: "vgrid" },
  { id: "artdeco", name: "Art-Deco Stone", wall: "#b9a884", frame: "#6b5f47", girder: "#c2b291", pattern: "arch" },
  { id: "steel", name: "Steel & Rivets", wall: "#4a4f57", frame: "#9aa2ab", girder: "#5c6470", pattern: "rect" },
];

/** Legacy / fallback style — matches the original bare-steel girder look. */
export const DEFAULT_FACADE = "steel";

const BY_ID: Record<string, Facade> = Object.fromEntries(FACADES.map((f) => [f.id, f]));

export function facadeById(id: string | undefined): Facade {
  return (id && BY_ID[id]) || BY_ID[DEFAULT_FACADE];
}

export function isFacade(id: string): boolean {
  return id in BY_ID;
}
