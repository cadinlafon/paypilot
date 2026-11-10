import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
  server: {
    port: 5320,
    // /api goes to the deployed Worker by default, so `npm run dev` works on its own.
    // To use a local Worker (`npm --prefix worker run dev`): API_PROXY_TARGET=http://127.0.0.1:8787 npm run dev
    proxy: { "/api": { target: process.env.API_PROXY_TARGET || "https://paypilot.cadinlafon.workers.dev", changeOrigin: true, secure: true } },
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes("node_modules/firebase") || id.includes("node_modules/@firebase") ? "firebase" : id.includes("node_modules/react-dom") || id.includes("node_modules/react-router") ? "react" : undefined),
      },
    },
  },
});
