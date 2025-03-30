import { paraglideVitePlugin } from "@inlang/paraglide-js"
import tailwindcss from "@tailwindcss/vite"
//import { svelteTesting } from "@testing-library/svelte/vite";
import { sveltekit } from "@sveltejs/kit/vite"
import { enhancedImages } from "@sveltejs/enhanced-img"
//import autoprefixer from 'autoprefixer'
import { defineConfig } from "vite"

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
  optimizeDeps: {
    exclude: ["bun", "bun:*"]
  },
  ssr: {
    external: ["bun", "bun:*"]
  },
  resolve: {
    external: ["bun", "bun:*"]
  }
  // test: {
  //   workspace: [
  //     {
  //       extends: "./vite.config.ts",
  //       plugins: [svelteTesting()],
  //       test: {
  //         name: "client",
  //         environment: "jsdom",
  //         clearMocks: true,
  //         include: ["src/**/*.svelte.{test,spec}.{js,ts}"],
  //         exclude: ["src/lib/server/**"],
  //         setupFiles: ["./vitest-setup-client.ts"]
  //       }
  //     },
  //     {
  //       extends: "./vite.config.ts",
  //       test: {
  //         name: "server",
  //         environment: "node",
  //         include: ["src/**/*.{test,spec}.{js,ts}"],
  //         exclude: ["src/**/*.svelte.{test,spec}.{js,ts}"]
  //       }
  //     }
  //   ]
  // }
})
