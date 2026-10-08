import { attempt } from "@juunibi/core";

export type AccentId = "gold" | "sakura" | "jade" | "violet";
export interface Accent { id: AccentId; label: string; light: { brand: string; fg: string }; dark: { brand: string; fg: string } }

/** `brand` is the accent (rings, glow, markers, send button); `fg` is the text/icon colour ON a brand-coloured surface. Contrast is unit-tested. */
export const ACCENTS: Accent[] = [
  { id: "gold", label: "Золото", light: { brand: "#8f6000", fg: "#1a1306" }, dark: { brand: "#d9a441", fg: "#1a1306" } },
  { id: "sakura", label: "Сакура", light: { brand: "#c2457a", fg: "#ffffff" }, dark: { brand: "#f08cb0", fg: "#2a0614" } },
  { id: "jade", label: "Нефрит", light: { brand: "#0b7a5d", fg: "#ffffff" }, dark: { brand: "#4cc9a4", fg: "#04281e" } },
  { id: "violet", label: "Фиалка", light: { brand: "#5b4bdb", fg: "#ffffff" }, dark: { brand: "#a79bff", fg: "#14103a" } },
];
export const ACCENT_IDS = ACCENTS.map((a) => a.id);

export const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
};
/** Sets --brand / --brand-fg on <html>. Gold is the stylesheet default, so it just clears the overrides. */
export function applyAccent(id: AccentId) {
  const root = document.documentElement.style;
  const a = ACCENTS.find((x) => x.id === id);
  if (!a || id === "gold") { root.removeProperty("--brand"); root.removeProperty("--brand-fg"); return; }
  const v = isDark() ? a.dark : a.light;
  attempt(() => { root.setProperty("--brand", v.brand); root.setProperty("--brand-fg", v.fg); });
}

/** Colour to show in a swatch for the current theme. */
export const swatchColor = (a: Accent) => (isDark() ? a.dark.brand : a.light.brand);
