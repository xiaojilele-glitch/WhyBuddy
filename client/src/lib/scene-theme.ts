import * as THREE from "three";

export const FUTURE_OFFICE_COLORS = {
  sceneBackground: "#F8FBFF",
  ambient: "#FFFFFF",
  hemisphereSky: "#FBFDFF",
  hemisphereGround: "#DDEAF5",
  keyLight: "#FFFFFF",
  fillLight: "#EAF6FF",
  practicalLight: "#DDF3FF",
  contactShadow: "#90A4B8",
  floorBase: "#F3F7FB",
  floorInset: "#EAF1F7",
  floorGlass: "#FFFFFF",
  floorLine: "#94A3B8",
  wall: "#F7FAFC",
  wallSide: "#EEF4F8",
  wallTrim: "#DCE8F2",
  panel: "#EDF4FA",
  panelFrame: "#C9D8E6",
  furniture: "#E2EAF3",
  furnitureAlt: "#D7E2EC",
  furnitureTrim: "#C2D1DE",
  fabric: "#E8EEF7",
  rug: "#E6F0F8",
  plant: "#9BE8D3",
  book: "#DDE9F5",
  paper: "#FFFFFF",
  screen: "#132238",
  screenSoft: "#1F2E46",
  cyan: "#38BDF8",
  cyanSoft: "#7DD3FC",
  blue: "#60A5FA",
  mint: "#2DD4BF",
  violet: "#A78BFA",
  rose: "#FB7185",
  green: "#34D399",
  warning: "#7DD3FC",
  slate: "#64748B",
  text: "#1E293B",
  mutedText: "#64748B",
} as const;

export const FUTURE_DEPARTMENT_COLORS = [
  FUTURE_OFFICE_COLORS.cyan,
  FUTURE_OFFICE_COLORS.blue,
  FUTURE_OFFICE_COLORS.mint,
  FUTURE_OFFICE_COLORS.violet,
] as const;

type ThemeableMaterial = THREE.Material & {
  color?: THREE.Color;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
  envMapIntensity?: number;
  metalness?: number;
  opacity?: number;
  roughness?: number;
  transparent?: boolean;
};

function includesAny(value: string, needles: string[]) {
  return needles.some(needle => value.includes(needle));
}

function setColor(material: ThemeableMaterial, color: string) {
  if (material.color) {
    material.color.set(color);
  }
}

export function rethemeFurnitureMaterial(
  material: THREE.Material,
  meshName: string,
  url: string
) {
  const themeable = material as ThemeableMaterial;
  const key = `${url} ${meshName} ${material.name}`.toLowerCase();

  if (typeof themeable.envMapIntensity === "number") {
    themeable.envMapIntensity = 0.24;
  }
  if (typeof themeable.roughness === "number") {
    themeable.roughness = Math.max(themeable.roughness, 0.72);
  }
  if (typeof themeable.metalness === "number") {
    themeable.metalness = Math.min(themeable.metalness, 0.18);
  }

  if (
    includesAny(key, [
      "screen",
      "display",
      "monitor",
      "laptop",
      "keyboard",
      "mouse",
    ])
  ) {
    setColor(themeable, FUTURE_OFFICE_COLORS.screen);
    if (themeable.emissive) {
      themeable.emissive.set(FUTURE_OFFICE_COLORS.cyan);
      themeable.emissiveIntensity = includesAny(key, [
        "screen",
        "display",
        "monitor",
      ])
        ? 0.22
        : 0.08;
    }
    if (typeof themeable.roughness === "number") {
      themeable.roughness = 0.38;
    }
    if (typeof themeable.metalness === "number") {
      themeable.metalness = 0.16;
    }
    return;
  }

  if (includesAny(key, ["floor", "rug"])) {
    setColor(
      themeable,
      key.includes("rug")
        ? FUTURE_OFFICE_COLORS.rug
        : FUTURE_OFFICE_COLORS.floorInset
    );
    if (typeof themeable.roughness === "number") {
      themeable.roughness = 0.9;
    }
    if (typeof themeable.metalness === "number") {
      themeable.metalness = 0.04;
    }
    return;
  }

  if (includesAny(key, ["wall", "doorway", "window"])) {
    setColor(
      themeable,
      includesAny(key, ["corner", "frame", "doorway"])
        ? FUTURE_OFFICE_COLORS.wallTrim
        : FUTURE_OFFICE_COLORS.wall
    );
    if (typeof themeable.roughness === "number") {
      themeable.roughness = 0.86;
    }
    return;
  }

  if (includesAny(key, ["plant", "leaf", "leaves"])) {
    setColor(themeable, FUTURE_OFFICE_COLORS.plant);
    if (themeable.emissive) {
      themeable.emissive.set(FUTURE_OFFICE_COLORS.mint);
      themeable.emissiveIntensity = 0.03;
    }
    return;
  }

  if (includesAny(key, ["book", "paper", "document"])) {
    setColor(
      themeable,
      key.includes("paper")
        ? FUTURE_OFFICE_COLORS.paper
        : FUTURE_OFFICE_COLORS.book
    );
    return;
  }

  if (includesAny(key, ["chair", "sofa", "lounge", "couch", "stool"])) {
    setColor(themeable, FUTURE_OFFICE_COLORS.fabric);
    return;
  }

  if (includesAny(key, ["lamp", "light"])) {
    setColor(themeable, FUTURE_OFFICE_COLORS.panelFrame);
    if (themeable.emissive) {
      themeable.emissive.set(FUTURE_OFFICE_COLORS.practicalLight);
      themeable.emissiveIntensity = 0.16;
    }
    if (typeof themeable.metalness === "number") {
      themeable.metalness = 0.22;
    }
    return;
  }

  if (
    includesAny(key, [
      "desk",
      "table",
      "bookcase",
      "shelf",
      "storage",
      "rack",
      "easel",
      "ladder",
      "cabinet",
    ])
  ) {
    setColor(themeable, FUTURE_OFFICE_COLORS.furniture);
    return;
  }

  setColor(themeable, FUTURE_OFFICE_COLORS.furnitureAlt);
}

/**
 * Kenney furniture body-color LOCK (2026-05-29 visual revision).
 *
 * Unlike `rethemeFurnitureMaterial` (which repaints furniture into the cold
 * future-office palette), this helper PRESERVES the Kenney Furniture Kit's own
 * authoritative GLB material colors — the warm-wood desks, off-white walls,
 * coral sofas, etc. that ship with the asset pack. It only tunes material
 * parameters that interact with the existing lights and adds a narrow,
 * name-matched screen/lamp emissive exception. It NEVER writes a body
 * `material.color`.
 *
 * Allowed:
 * - `roughness` / `metalness` tuning (toy-plastic relief; no env map in scene)
 * - emissive ONLY for functional `screen` / `display` / `monitor` / `lamp`
 *   meshes (a dark screen glow or a lamp glow), matched narrowly by name
 *
 * NOT allowed:
 * - `material.color.set(...)` on ANY mesh (wood / wall / door / fabric / floor)
 * - a fallback that repaints unmatched meshes
 *
 * Used by the blueprint role workstations (`WorkstationModel`) so the desks
 * keep their real Kenney colors, matching the pet body-color lock.
 */
export function preserveKenneyFurnitureMaterial(
  material: THREE.Material,
  meshName: string,
  url: string
) {
  const themeable = material as ThemeableMaterial;
  const key = `${url} ${meshName} ${material.name}`.toLowerCase();

  // Parameter-only relief: lower roughness a touch (cap 0.7) for some specular
  // pop under the directional/spot/point lights, keep metalness low. No env map
  // exists in the scene, so envMapIntensity is intentionally NOT relied upon.
  if (typeof themeable.roughness === "number") {
    themeable.roughness = Math.min(themeable.roughness, 0.7);
  }
  if (typeof themeable.metalness === "number") {
    themeable.metalness = Math.min(themeable.metalness, 0.1);
  }

  // Narrow functional exception: screens get a subtle self-lit glow. This is
  // the screen surface only (a device, not a wood/wall/fabric body) and is the
  // sole place we touch emissive — we still do NOT recolor the screen body.
  if (includesAny(key, ["screen", "display", "monitor"])) {
    if (themeable.emissive) {
      themeable.emissive.set(FUTURE_OFFICE_COLORS.cyan);
      themeable.emissiveIntensity = 0.16;
    }
    return;
  }

  // Lamp bulb/shade may glow softly, but the lamp BODY color is left as-is.
  if (includesAny(key, ["lamp", "bulb"])) {
    if (themeable.emissive) {
      themeable.emissive.set(FUTURE_OFFICE_COLORS.practicalLight);
      themeable.emissiveIntensity = 0.12;
    }
    return;
  }

  // Everything else: keep the authoritative Kenney GLB color untouched.
}
