import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const shim = (f: string) => fileURLToPath(new URL(`./src/hosted/shims/${f}`, import.meta.url));

const api = `http://127.0.0.1:${process.env.API_PORT ?? 4000}`;
// Browser always uses relative /api paths; the dev server proxies to the laptop's API (works from LAN clients too).
export default defineConfig({
  plugins: [react(), tailwind()],
  // Hosted mode bundles the backend for the browser: Node built-ins map to small browser stand-ins.
  resolve: { alias: { "node:sqlite": shim("node-sqlite.ts"), "node:crypto": shim("node-crypto.ts"), "node:fs": shim("node-fs.ts"), "node:path": shim("node-misc.ts"), "node:url": shim("node-misc.ts"), "node:os": shim("node-misc.ts"), "node:events": "events" } },
  define: { "import.meta.env.VITE_HOSTED": JSON.stringify(process.env.VITE_HOSTED ?? "") },
  server: { port: Number(process.env.WEB_PORT ?? 3000), strictPort: true, allowedHosts: [".trycloudflare.com"], proxy: { "/api": { target: api, changeOrigin: false }, "/docs": api, "/health": api, "/ready": api } },
  preview: { port: Number(process.env.WEB_PORT ?? 3000), proxy: { "/api": api } },
  build: { chunkSizeWarningLimit: 1500 },
});
