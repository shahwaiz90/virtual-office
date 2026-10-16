// Every palette resolves to a CSS variable from src/styles/tokens.css, so themes swap values, not classes.
// (Previously this config lived inline in index.html for the Tailwind CDN; now it is built with Vite.)
const palettes = ['sand', 'brand', 'clay', 'olive', 'slate', 'gray', 'zinc', 'neutral', 'stone', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose', 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue'];
const steps = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

const colors = {};
for (const p of palettes) {
  colors[p] = {};
  for (const s of steps) colors[p][s] = `rgb(var(--c-${p}-${s}) / <alpha-value>)`;
}
Object.assign(colors, {
  surface: { DEFAULT: token('surface'), raised: token('surface-raised') },
  canvas: token('canvas'),
  fg: { DEFAULT: token('fg'), muted: token('fg-muted'), subtle: token('fg-subtle') },
  line: { DEFAULT: token('line'), strong: token('line-strong') },
  accent: { DEFAULT: token('accent'), hover: token('accent-hover'), soft: token('accent-soft') },
  success: token('success'),
  warning: token('warning'),
  danger: token('danger'),
  info: token('info'),
  scrim: token('scrim'),
});

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors,
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      boxShadow: { card: 'var(--shadow-card)', pop: 'var(--shadow-pop)' },
      borderRadius: { token: 'var(--radius-md)' },
    },
  },
};
