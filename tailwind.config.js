/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/renderer/index.html", "./src/renderer/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eff8ff",
          100: "#daefff",
          200: "#bce2ff",
          300: "#8ccdff",
          400: "#55b0ff",
          500: "#2e8fff",
          600: "#1a6ff5",
          700: "#1558e1",
          800: "#1847b6",
          900: "#193f8f",
          950: "#142757",
        },
      },
    },
  },
  plugins: [],
};
