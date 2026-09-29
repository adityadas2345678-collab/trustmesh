import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

const api = `http://127.0.0.1:${process.env.API_PORT ?? 4000}`;
// Browser always uses relative /api paths; the dev server proxies to the laptop's API (works from LAN clients too).
export default defineConfig({
  plugins: [react(), tailwind()],
  server: { port: Number(process.env.WEB_PORT ?? 3000), strictPort: true, allowedHosts: [".trycloudflare.com"], proxy: { "/api": { target: api, changeOrigin: false }, "/docs": api, "/health": api, "/ready": api } },
  preview: { port: Number(process.env.WEB_PORT ?? 3000), proxy: { "/api": api } },
  build: { chunkSizeWarningLimit: 1500 },
});
