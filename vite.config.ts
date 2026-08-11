import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json";

export default defineConfig({
  plugins: [
    react(),
    crx({
      manifest
    })
  ],

  build: {
    outDir: "dist",
    emptyOutDir: true,

    rollupOptions: {
      input: {
        popup: "src/ui/popup/index.html",
        options: "src/ui/options/index.html"
      }
    }
  },

  server: {
    cors: {
      origin: [
        /chrome-extension:\/\//
      ]
    }
  }
});