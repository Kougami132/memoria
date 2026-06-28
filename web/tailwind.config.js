/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/main.tsx",
    "./src/api.ts",
    "./src/App.tsx",
    "./src/App.css",
    "./src/components/Layout.tsx",
    "./src/components/ui/badge.tsx",
    "./src/components/ui/button.tsx",
    "./src/components/ui/card.tsx",
    "./src/components/ui/checkbox.tsx",
    "./src/components/ui/input.tsx",
    "./src/components/ui/label.tsx",
    "./src/components/ui/select.tsx",
    "./src/components/ui/textarea.tsx",
    "./src/lib/utils.ts",
    "./src/pages/Bots.tsx",
    "./src/pages/Chat.tsx",
    "./src/pages/KnowledgeBases.tsx",
    "./src/pages/Settings.tsx",
  ],
  theme: {
    extend: {
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      colors: {
        brand: {
          from: '#9333ea',
          to:   '#3b82f6',
        },
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: {
          DEFAULT: 'var(--card)',
          foreground: 'var(--card-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        muted: {
          DEFAULT: 'var(--muted)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        destructive: 'var(--destructive)',
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        chart: {
          '1': 'var(--chart-1)',
          '2': 'var(--chart-2)',
          '3': 'var(--chart-3)',
          '4': 'var(--chart-4)',
          '5': 'var(--chart-5)',
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
