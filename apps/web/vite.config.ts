import { defineConfig } from "vite";
// In dev the API lives on the Node server; the browser never sees the Cloud.ru key.
export default defineConfig({
  build: { target: "es2022", sourcemap: true },
  server: { proxy: { "/api": process.env.VITE_API_TARGET ?? "http://127.0.0.1:4173" } },
});
