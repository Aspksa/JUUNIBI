export type Props = Record<string, unknown>;
/** Tiny element factory. `cls` sets className; every other key is assigned as a DOM property. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...kids: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const { cls, attrs, ...rest } = props as Props & { attrs?: Record<string, string> };
  const n = Object.assign(document.createElement(tag), rest);
  if (typeof cls === "string") n.className = cls;
  if (attrs) for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  for (const k of kids) if (k !== null && k !== undefined && k !== false) n.append(k);
  return n;
}

const NS = "http://www.w3.org/2000/svg";
const ICONS = {
  home: "M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10",
  memory: "M12 3a6 6 0 0 0-3 11.2V17h6v-2.8A6 6 0 0 0 12 3zM9 20h6",
  modules: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  spark: "M12 3l2.2 6.3L21 12l-6.8 2.7L12 21l-2.2-6.3L3 12l6.8-2.7z",
  book: "M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h10",
  target: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  scenes: "M4 7h16v12H4zM4 7l2.5-4M10 7l2.5-4M16 7l2.5-4M4 11h16",
  puzzle: "M9 4h4v2.5a1.5 1.5 0 1 0 3 0V4h4v5h-2.5a1.5 1.5 0 1 0 0 3H20v8h-5v-2.5a1.5 1.5 0 1 0-3 0V20H4v-5h2.5a1.5 1.5 0 1 0 0-3H4V4h5z",
  play: "M8 5l11 7-11 7z",
  link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
  brain: "M3.5 6.5a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0M15.5 6.5a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0M9.5 18a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0M7 8.7l3.9 7M17 8.7l-3.9 7M8.5 6.5h7",
  update: "M12 4v10m0 0-4-4m4 4 4-4M5 19h14",
  settings: "M4 7h9M17 7h3M4 17h3M11 17h9M15 4v6M9 14v6",
  chat: "M4 5h16v11H9l-5 4z",
  plus: "M12 5v14M5 12h14",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3",
  send: "M12 19V5M5 12l7-7 7 7",
  stop: "M7 7h10v10H7z",
  copy: "M9 9h10v10H9zM5 15V5h10",
  up: "M7 11v9H4v-9zM7 11l4-8c1.5 0 2.5 1 2.5 2.5V9h5a2 2 0 0 1 2 2.3l-1.3 7A2 2 0 0 1 17.2 20H7",
  down: "M17 13V4h3v9zM17 13l-4 8c-1.5 0-2.5-1-2.5-2.5V15h-5a2 2 0 0 1-2-2.3l1.3-7A2 2 0 0 1 6.8 4H17",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6",
  edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  menu: "M4 6h16M4 12h16M4 18h16",
  x: "M6 6l12 12M18 6L6 18",
  maximize: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  minimize: "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5",
  sidebar: "M4 5h16v14H4zM9 5v14",
  chevron: "M6 9l6 6 6-6",
  check: "M5 13l4 4L19 7",
  arrowDown: "M12 5v14M5 12l7 7 7-7",
  alert: "M12 8v5M12 17h.01M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  sun: "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 1v3M12 20v3M1 12h3M20 12h3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M19.8 4.2l-2.1 2.1M6.3 17.7l-2.1 2.1",
  moon: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z",
  auto: "M12 3a9 9 0 1 0 0 18V3z",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  cloud: "M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5 4 4 0 0 1 17 18z",
  shield: "M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6zM9 12l2 2 4-4",
  folder: "M3 6h6l2 2h10v11H3z",
  circleCheck: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12.5l2.7 2.7L16 9.8",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  paperclip: "M21 11.5l-8.6 8.6a5 5 0 0 1-7-7l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4L15 6.8",
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3",
  volume: "M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12",
  file: "M6 3h8l4 4v14H6zM14 3v4h4",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01",
  view: "M4 6h16M7 12h10M10 18h4",
  download: "M12 4v12m0 0-4-4m4 4 4-4M5 20h14",
} as const;
export type IconName = keyof typeof ICONS;
const FILLED = new Set<IconName>(["stop"]);

export function icon(name: IconName, size = 20): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size)); svg.setAttribute("height", String(size));
  svg.setAttribute("fill", FILLED.has(name) ? "currentColor" : "none");
  svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", ICONS[name]);
  svg.append(p);
  return svg;
}

/** Icon-only button with an accessible name and tooltip. */
export function iconButton(name: IconName, label: string, onClick: (e: MouseEvent) => void, cls = "icon-btn"): HTMLButtonElement {
  const b = el("button", { type: "button", cls, title: label, attrs: { "aria-label": label } }, icon(name, 18));
  b.addEventListener("click", onClick);
  return b;
}

export const short = (v?: string | null) => (v && /^[0-9a-f]{40}$/.test(v) ? v.slice(0, 8) : v ?? "…");
