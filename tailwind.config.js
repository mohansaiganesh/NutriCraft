/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // NutriCraft "Garden" palette — light, fresh, produce-market green.
        brand: {
          DEFAULT: '#2F9E44', // kelly green (primary)
          light: '#40C057',
          ink: '#1B5E2A', // deep green for text-on-light
        },
        // Macro accents — kept distinct from the brand green.
        cal: '#2F9E44',
        protein: '#E8590C',
        carbs: '#F08C00',
        fat: '#7048E8',
        fiber: '#0CA678', // teal, so it never clashes with the brand green
        cost: '#64748B',
        over: '#E03131',
        // Surfaces & text
        paper: '#F6F8F3', // app background
        card: '#FFFFFF',
        hair: '#E3EADD', // hairline borders
        ink: '#16241A', // primary text
        ink2: '#5B6B5E', // muted text
        ink3: '#8B9A8D', // faint text / placeholders
      },
      fontFamily: {
        // Display — Bricolage Grotesque (headings, big numbers)
        display: ['BricolageGrotesque_800ExtraBold'],
        'display-sb': ['BricolageGrotesque_700Bold'],
        'display-md': ['BricolageGrotesque_600SemiBold'],
        // Body / UI — Plus Jakarta Sans
        body: ['PlusJakartaSans_400Regular'],
        'body-md': ['PlusJakartaSans_500Medium'],
        'body-sb': ['PlusJakartaSans_600SemiBold'],
        'body-b': ['PlusJakartaSans_700Bold'],
      },
    },
  },
  plugins: [],
};
