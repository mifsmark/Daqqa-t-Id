/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cream: "#f7f3e9",
        ink: "#183a37",
        teal: "#176b61",
        clay: "#c96548",
        sand: "#e9dfca",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: { "4xl": "2rem" },
    },
  },
  plugins: [],
};
