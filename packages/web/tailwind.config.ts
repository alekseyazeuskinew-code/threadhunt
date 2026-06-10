import type { Config } from 'tailwindcss';

// Палитра «Lime-заряд» — токены берутся из CSS-переменных (globals.css),
// чтобы тема была в одном месте. См. BRAND.md.
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        panel: 'var(--panel)',
        'panel-2': 'var(--panel-2)',
        line: 'var(--border)',
        text: 'var(--text)',
        muted: 'var(--muted)',
        accent: {
          DEFAULT: 'var(--accent)',
          press: 'var(--accent-press)',
          soft: 'var(--accent-soft)',
        },
        // текст на фиолетовой заливке (фолбэк белый — на случай несработавшей переменной)
        'on-accent': 'var(--on-accent, #ffffff)',
        // акцент как ТЕКСТ/иконка — читаемый в обеих темах
        'accent-ink': 'var(--accent-ink, var(--accent))',
        success: 'var(--success)',
        danger: 'var(--danger)',
        warning: 'var(--warning)',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        display: ['var(--font-space)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
