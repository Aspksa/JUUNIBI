/**
 * «Диск» icons, drawn in the app's own line style (24-grid, 1.8 stroke, round caps) so they sit next to
 * the menu icons, plus coloured file badges: a page with a folded corner, a glyph for the kind and the extension.
 */
import { icon, type IconName } from "../dom";
import { extOf, kindOf, type FileKind } from "./disk-model";

const NS = "http://www.w3.org/2000/svg";
const PATHS = {
  upload: "M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M5 15v4h14v-4",
  folderPlus: "M3 6h6l2 2h10v11H3zM12 11v5M9.5 13.5h5",
  folderOpen: "M3 8V5h6l2 2h9v4M3 11h19l-3 9H5z",
  move: "M3 6h6l2 2h10v11H3zM10 13.5h6m0 0-2.5-2.5m2.5 2.5L13.5 16",
  copy: "M8 8h11v12H8zM5 16V4h11",
  cut: "M6.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM6.5 20a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8.6 7.6 20 17M8.6 16.4 20 7",
  paste: "M9 4h6v3H9zM7 5.5H5V21h14V5.5h-2M9 12h6M9 16h4",
  rename: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  tag: "M3 12V4h8l10 10-8 8zM7.5 8.5h.01",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5h.01",
  versions: "M12 21a9 9 0 1 0-8.5-6M3 20v-5h5M12 7v5l3 2",
  history: "M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4M12 8v4l3 2",
  chronicle: "M4 19 9 9l4 5 3-6 4 11M9 9a1.5 1.5 0 1 0 0-3M16 8a1.5 1.5 0 1 0 0-3M3 21h18",
  audit: "M12 3l8 3.5V12c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6.5zM8.5 12l2.5 2.5 4.5-5",
  exportList: "M5 4h10l4 4v12H5zM9 11h6M9 15h4M15 4v4h4",
  backup: "M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 7v10c0 1.7 3.6 3 8 3M20 7v4M17 15v6m0-6-2.5 2.5M17 15l2.5 2.5",
  restore: "M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 7v10c0 1.7 3.6 3 8 3M20 7v4M17 21v-6m0 6-2.5-2.5M17 21l2.5-2.5",
  tiles: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  large: "M3.5 4h17v10h-17zM3.5 17.5h17M3.5 20.5h10",
  listView: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  table: "M3.5 4.5h17v15h-17zM3.5 9.5h17M3.5 14.5h17M9 4.5v15",
  filter: "M4 5h16l-6 7.5V19l-4 1.5v-8z",
  heavy: "M6 20h12l-1.5-11h-9zM9.5 9a2.5 2.5 0 1 1 5 0",
  recent: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  docs: "M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5",
  sweep: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3M17.5 3.5 21 7",
  ask: "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z",
  drawer: "M4 4h16v16H4zM9.5 4v16",
  sparkleCheck: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12.5l2.7 2.5L16 9.5",
  warn: "M12 4 2.8 20h18.4zM12 10v4.5M12 17.5h.01",
  keep: "M5 12.5l4.5 4.5L19 7.5",
  zoomIn: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3M11 8v6M8 11h6",
  zoomOut: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3M8 11h6",
  vault: "M4 6h16v13H4zM4 10h16M9 14.5h6M12 6V4",
  disk: "M3 12h18v6H3zM5.5 12 8 6h8l2.5 6M16.5 15h.01M13.5 15h.01",
  zipDown: "M6 3h9l4 4v14H6zM11 3v2M11 7v2M11 11v2M9.5 15h3v3h-3zM15 3v4h4",
  folderUp: "M3 6h6l2 2h10v11H3zM12 17v-6m0 0-2.5 2.5M12 11l2.5 2.5",
  attach: "M20 11.5 12.2 19.3a5 5 0 0 1-7.1-7.1l8-8a3.3 3.3 0 0 1 4.7 4.7l-8 8a1.7 1.7 0 0 1-2.4-2.4l7.3-7.3",
  chatIn: "M4 5h16v11H9l-5 4zM12 7.5v6m0 0-2.5-2.5M12 13.5l2.5-2.5",
  markdown: "M3 6h18v12H3zM6.5 15V9l2.5 3 2.5-3v6M15.5 9v6m0 0-2-2m2 2 2-2",
} as const;
export type DiskIconName = keyof typeof PATHS | IconName;
const FILLED = new Set<string>(["ask"]);

/** One icon: the Disk's own drawings first, then the app's shared set. */
export function dIcon(name: DiskIconName, size = 18): SVGSVGElement {
  if (!(name in PATHS)) return icon(name as IconName, size);
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size)); svg.setAttribute("height", String(size));
  svg.setAttribute("fill", FILLED.has(name) ? "currentColor" : "none");
  svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", PATHS[name as keyof typeof PATHS]);
  svg.append(p);
  return svg;
}

/** The colour of each file kind; CSS takes it as --k for the badge, the tag and the hover ring. */
export const KIND_COLOR: Record<FileKind, string> = {
  image: "#1f9d8f", video: "#7c5cf0", audio: "#d9468b", pdf: "#e0443a", doc: "#2f6fdf", sheet: "#1b9a52",
  slides: "#e27a2c", text: "#6f7684", code: "#5a5fd0", archive: "#b07d1c", other: "#8a8f99",
};
/** Glyphs drawn inside the page (32 × 40 box, centred around y = 21). */
const GLYPH: Record<FileKind, { d: string; fill?: boolean }> = {
  image: { d: "M9 26.5l4.6-5.6 3 3.3 3.6-4.6 4.8 6.9zM12.4 17.6a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8z", fill: true },
  video: { d: "M13 14.5v11l9-5.5z", fill: true },
  audio: { d: "M13.6 24.6V15.8l7.6-1.8v8.6M13.6 24.6a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0zM21.2 22.6a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0z" },
  pdf: { d: "M10 14.5h12M10 18.5h12M10 22.5h7" },
  doc: { d: "M10 14.5h12M10 18.5h12M10 22.5h12M10 26h7" },
  sheet: { d: "M9.5 14h13v12h-13zM9.5 18h13M9.5 22h13M14 14v12" },
  slides: { d: "M9 14.5h14v9H9zM16 23.5v3M13 26.5h6M12 20.5l2.5-2.5 2 2 3-3" },
  text: { d: "M10 15h12M10 19h9M10 23h11" },
  code: { d: "M13 16l-4 4 4 4M19 16l4 4-4 4M17 14.5l-2 11" },
  archive: { d: "M16 5v2.4M16 9.6v2.4M16 14.2v2.4M13.8 18.6h4.4v5.2h-4.4zM16 21.2v.01" },
  other: { d: "M12 20h.01M16 20h.01M20 20h.01" },
};
/** A file badge: tinted page, kind glyph and the extension on a coloured label. */
export function fileBadge(name: string, size = 36): SVGSVGElement {
  const kind = kindOf(name), ext = extOf(name).slice(0, 4).toUpperCase();
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 32 40");
  svg.setAttribute("width", String(Math.round(size * 0.8))); svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
  svg.classList.add("dk-badge");
  svg.style.setProperty("--k", KIND_COLOR[kind]);
  const part = (tag: string, attrs: Record<string, string>) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    svg.append(n); return n;
  };
  part("path", { class: "dk-page", d: "M7 2.5h13.5L28 10v25.5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-31a2 2 0 0 1 2-2z" });
  part("path", { class: "dk-fold", d: "M20.5 2.5V8a2 2 0 0 0 2 2H28" });
  const g = GLYPH[kind];
  part("path", { class: g.fill ? "dk-glyph fill" : "dk-glyph", d: g.d });
  if (ext) {
    part("rect", { class: "dk-label", x: "2", y: "28.5", width: String(Math.max(16, ext.length * 5.4 + 6)), height: "8.5", rx: "2.2" });
    const t = part("text", { class: "dk-ext", x: String(2 + Math.max(16, ext.length * 5.4 + 6) / 2), y: "35", "text-anchor": "middle" });
    t.textContent = ext;
  }
  return svg;
}
/** A folder drawn in the folder's own colour; open while it is the current one. */
export function folderGlyph(open: boolean, size = 18): SVGSVGElement {
  return dIcon(open ? "folderOpen" : "folder", size);
}
