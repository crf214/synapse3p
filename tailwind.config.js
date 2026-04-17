/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-body)'],
        display: ['var(--font-display)'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      colors: {
        stone: {
          25: '#FAFAF9',
          950: '#0C0A09',
        },
      },
    },
  },
  plugins: [],
}
