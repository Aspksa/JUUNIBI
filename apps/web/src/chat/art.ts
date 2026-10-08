import { el } from "../dom";

/** The assistant's picture: /avatar.webp if present (drop your own image into apps/web/public), otherwise a monogram. */
export function characterAvatar(size: number, cls = ""): HTMLElement {
  const letter = el("span", { cls: "av-letter", textContent: "J" });
  const img = el("img", { alt: "", cls: "av-img", draggable: false });
  img.addEventListener("load", () => letter.remove(), { once: true });
  img.addEventListener("error", () => img.remove(), { once: true });
  img.src = "/avatar.webp";
  const root = el("span", { cls: ("av " + cls).trim(), attrs: { "aria-hidden": "true" } }, letter, img);
  root.style.width = root.style.height = size + "px";
  root.style.fontSize = Math.round(size * 0.46) + "px";
  return root;
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  return h >= 5 && h < 11 ? "Доброе утро" : h >= 11 && h < 17 ? "Добрый день" : h >= 17 && h < 23 ? "Добрый вечер" : "Доброй ночи";
}
