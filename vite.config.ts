import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import { enhancedImages } from "@sveltejs/enhanced-img";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    enhancedImages(),
    tailwindcss(),
    sveltekit(),
    paraglideVitePlugin({
      project: "./project.inlang",
      outdir: "./src/lib/paraglide",
      strategy: ["url", "cookie", "baseLocale"]
    })
  ],
  server: {
    port: 3000,
    host: true,
    allowedHosts: true,
    cors: true
  },
  build: {
    target: "es2020",
    sourcemap: true
  },
  preview: {
    host: true,
    allowedHosts: true,
    port: 3000,
    cors: true
  },
  optimizeDeps: {
    exclude: ["bun"]
  },
  ssr: {
    external: ["bun"]
  },
  resolve: {
    external: ["bun"],
    alias: {
      os: "rollup-plugin-node-polyfills/polyfills/empty",
      stream: "rollup-plugin-node-polyfills/polyfills/empty"
    }
  },
});
