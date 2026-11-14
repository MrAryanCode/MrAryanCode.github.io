// Build-time tables for the field (algorithms.md A-2 Assumption 5, D-042, D-052, D-054). Nothing here is decided at run
// time. T-035 replaces each entry with its measured branch before release; T-018 ships the start values.
export type Theme = "dark" | "light";
export type WidthClass = "desk" | "phone";
export type FormationMode = "vortex" | "inplace" | "hold";
export type MaskPage = "home" | "404";
export type Variant = "full" | "soft" | "off";
export type Effect = "breathing" | "dissolve" | "phone" | "k3" | "k5";

/** FORMATION_MODE[page][theme][width class]: the start values are `inplace` for the home name, light theme, desk, and
 *  `vortex` for every other entry (D-042 as recorded today). */
export const FORMATION_MODE: Record<MaskPage, Record<Theme, Record<WidthClass, FormationMode>>> = {
  home: {
    dark: { desk: "vortex", phone: "vortex" },
    light: { desk: "inplace", phone: "vortex" },
  },
  "404": {
    dark: { desk: "vortex", phone: "vortex" },
    light: { desk: "vortex", phone: "vortex" },
  },
};

/** EFFECT_MODE[effect][theme][width class] (D-052): every entry starts at `full`. The phone-cells effect has no desk
 *  entries, so the two desk cells of that row do not exist. */
export const EFFECT_MODE: Record<Effect, Record<Theme, Partial<Record<WidthClass, Variant>>>> = {
  breathing: { dark: { desk: "full", phone: "full" }, light: { desk: "full", phone: "full" } },
  dissolve: { dark: { desk: "full", phone: "full" }, light: { desk: "full", phone: "full" } },
  phone: { dark: { phone: "full" }, light: { phone: "full" } },
  k3: { dark: { desk: "full", phone: "full" }, light: { desk: "full", phone: "full" } },
  k5: { dark: { desk: "full", phone: "full" }, light: { desk: "full", phone: "full" } },
};
