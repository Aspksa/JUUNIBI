import { defineConfig } from "vite";
// In dev the API lives on the Node server; the browser never sees the Cloud.ru key.
// changeOrigin stays off: the server compares Origin with Host (CSRF guard), so Host must remain the page's own.
export default defineConfig({
  build: { target: "es2022", sourcemap: true },
  server: { proxy: { "/api": { target: process.env.VITE_API_TARGET ?? "http://127.0.0.1:4173", changeOrigin: false } } },
});
