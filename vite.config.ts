import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      $core: resolve(__dirname, "src/core"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        chat: resolve(__dirname, "examples/chat/index.html"),
        tutor: resolve(__dirname, "examples/tutor/index.html"),
      },
    },
  },
});
