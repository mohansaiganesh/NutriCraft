/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Macro accent colors used across the app
        cal: '#0ea5e9',
        protein: '#ef4444',
        carbs: '#f59e0b',
        fat: '#8b5cf6',
        fiber: '#10b981',
        cost: '#64748b',
      },
    },
  },
  plugins: [],
};
