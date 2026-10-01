/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        paper: 'var(--paper)', card: 'var(--card)', sunk: 'var(--sunk)',
        ink: 'var(--ink)', ink2: 'var(--ink-2)', muted: 'var(--muted)', line: 'var(--line)',
        accent: 'var(--accent)', 'accent-soft': 'var(--accent-soft)',
        ok: 'var(--ok)', 'ok-soft': 'var(--ok-soft)', warn: 'var(--warn)', 'warn-soft': 'var(--warn-soft)', bad: 'var(--bad)', 'bad-soft': 'var(--bad-soft)',
      },
      fontFamily: {
        display: ['"Instrument Serif"', 'Georgia', 'serif'],
        sans: ['"Schibsted Grotesk"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
