import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import glsl from "vite-plugin-glsl";

export default defineConfig({
	plugins: [tailwindcss(), glsl()],
	// Relative asset URLs work from both Vercel's domain root and the
	// /three-ml-sharp/ subdirectory used by GitHub Pages.
	base: "./",
});
