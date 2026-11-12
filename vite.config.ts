import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  preview: {
    headers: { 'Cache-Control': 'no-store' },
  },
  optimizeDeps: {
    // These libraries are first imported from workers or after file selection.
    // Discovering them during an import causes Vite to reload and drop the job.
    include: ['heic-to/next', 'pdfjs-dist'],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
