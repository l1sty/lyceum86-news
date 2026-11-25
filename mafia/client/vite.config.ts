import { defineConfig } from "vite";
export default defineConfig({
  base: "/mafia/",
  build: { outDir: "../dist", emptyOutDir: true },
});
