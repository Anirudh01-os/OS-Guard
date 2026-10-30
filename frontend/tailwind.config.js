/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: { 950: "#07090c", 900: "#0b0e13", 850: "#10141b", 800: "#161b24", 700: "#1f2631", 600: "#2b3442", 500: "#3b4658" },
        cyan: { glow: "#3de8ff", soft: "#8af2ff", deep: "#0ea5b7" },
        ok: "#4ade80", warn: "#fbbf24", bad: "#fb7185", crit: "#ff4d6d", info: "#7aa7ff",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Consolas", "monospace"],
      },
      boxShadow: { glow: "0 0 0 1px rgba(61,232,255,.25), 0 8px 40px -8px rgba(61,232,255,.25)" },
    },
  },
  plugins: [],
};
