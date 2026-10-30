import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Cookbook tokens (DESIGN.md)
        ink: {
          DEFAULT: "hsl(var(--ink))",
          foreground: "hsl(var(--ink-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          tint: "hsl(var(--success-tint))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          tint: "hsl(var(--warning-tint))",
        },
        highlight: "hsl(var(--highlight))",
        plate: "hsl(var(--plate))",
        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))",
          5: "hsl(var(--chart-5))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      // Wrapped story slides
      keyframes: {
        // Something arriving in a list as it streams in (Help me choose).
        "rise-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        // The AI-wait components (components/ai-wait): DESIGN.md → AI at work.
        "plate-reel": { from: { transform: "translateY(0)" }, to: { transform: "translateY(-50%)" } },
        "plate-belt": { from: { transform: "translateX(0)" }, to: { transform: "translateX(-50%)" } },
        "plate-land": {
          "0%": { opacity: "0", transform: "scale(0.6)" },
          "70%": { opacity: "1", transform: "scale(1.08)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "plate-hop": { "0%, 60%, 100%": { transform: "translateY(0)" }, "30%": { transform: "translateY(-5px)" } },
        "plate-breathe": {
          "0%, 100%": { opacity: "0.5", transform: "scale(0.94)" },
          "50%": { opacity: "1", transform: "scale(1)" },
        },
        steam: {
          "0%": { opacity: "0", transform: "translateY(8px) scaleY(0.8)" },
          "35%": { opacity: "0.9" },
          "100%": { opacity: "0", transform: "translateY(-16px) scaleY(1.15)" },
        },
        develop: {
          "0%, 100%": { filter: "blur(18px) saturate(0.6)", transform: "scale(1.04)" },
          "50%": { filter: "blur(5px) saturate(1)", transform: "scale(1)" },
        },
        "soft-pulse": { "0%, 100%": { opacity: "0.5" }, "50%": { opacity: "1" } },
        // A link being read: dots travel from the page to the plate, which fills.
        "dot-travel": {
          "0%": { transform: "translateX(0)", opacity: "0" },
          "20%, 80%": { opacity: "1" },
          "100%": { transform: "translateX(36px)", opacity: "0" },
        },
        "plate-fill": { "0%": { transform: "scale(0)" }, "35%, 80%": { transform: "scale(1)" }, "100%": { transform: "scale(0)" } },
        // Over a photo that's being replaced: the old one drifts in and out of focus.
        "develop-veil": {
          "0%, 100%": { backdropFilter: "blur(16px) saturate(0.7)" },
          "50%": { backdropFilter: "blur(4px) saturate(1)" },
        },
        "wrapped-rise": {
          from: { opacity: "0", transform: "translateY(24px) scale(0.97)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "wrapped-pop": {
          "0%": { opacity: "0", transform: "scale(0.4) rotate(-8deg)" },
          "70%": { opacity: "1", transform: "scale(1.08) rotate(2deg)" },
          "100%": { transform: "scale(1) rotate(0)" },
        },
        "wrapped-blob": {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "33%": { transform: "translate(30px, -40px) scale(1.15)" },
          "66%": { transform: "translate(-25px, 20px) scale(0.9)" },
        },
        "wrapped-progress": {
          from: { transform: "scaleX(0)" },
          to: { transform: "scaleX(1)" },
        },
      },
      animation: {
        "rise-in": "rise-in 0.35s cubic-bezier(0.2, 0.8, 0.2, 1) both",
        "plate-reel": "plate-reel 1.6s linear infinite",
        "plate-belt": "plate-belt 1.8s linear infinite",
        "plate-land": "plate-land 0.5s cubic-bezier(0.2, 1.2, 0.4, 1) both",
        "plate-hop": "plate-hop 1.2s ease-in-out infinite",
        "plate-breathe": "plate-breathe 2.4s ease-in-out infinite",
        steam: "steam 2.4s ease-out infinite",
        develop: "develop 6s ease-in-out infinite",
        "soft-pulse": "soft-pulse 1.6s ease-in-out infinite",
        "dot-travel": "dot-travel 1.5s ease-in-out infinite",
        "plate-fill": "plate-fill 3s ease-in-out infinite",
        "develop-veil": "develop-veil 6s ease-in-out infinite",
        "wrapped-rise": "wrapped-rise 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) both",
        "wrapped-pop": "wrapped-pop 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) both",
        "wrapped-blob": "wrapped-blob 12s ease-in-out infinite",
        "wrapped-progress": "wrapped-progress linear both",
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"SF Pro Display"',
          '"Segoe UI"',
          "Roboto",
          "sans-serif",
        ],
        // Fraunces, self-hosted by next/font in app/layout.tsx
        serif: ["var(--font-serif)", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};

export default config;
