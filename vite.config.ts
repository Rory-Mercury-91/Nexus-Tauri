import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Format objet : Rollup résout lui-même les dépendances transitives
        // sans risque de dépendances circulaires entre chunks.
        manualChunks: {
          "vendor-react":    ["react", "react-dom"],
          "vendor-router":   ["react-router-dom"],
          "vendor-supabase": ["@supabase/supabase-js"],
          "vendor-charts":   ["recharts"],
          "vendor-icons":    ["lucide-react"],
        },
      },
    },
    // Silence l'avertissement de taille de chunk (protobufjs/recharts gonflent inévitablement)
    chunkSizeWarningLimit: 700,
  },
}));
