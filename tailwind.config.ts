import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

// https://animation-svelte.vercel.app/luxe

const config: Config = {
  darkMode: false,
  content: ["./src/**/*.{html,js,svelte,ts}"],
  //	safelist: ["dark"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px"
      }
    },
    extend: {
      colors: {
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        ring: "hsl(var(--ring) / <alpha-value>)",
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)"
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)"
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)"
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)"
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)"
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)"
        },
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)"
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))"
        },
        "color-1": "hsl(var(--color-1))",
        "color-2": "hsl(var(--color-2))",
        "color-3": "hsl(var(--color-3))",
        "color-4": "hsl(var(--color-4))",
        "color-5": "hsl(var(--color-5))",
        gradient: "gradient 8s linear infinite",
        shimmer: "shimmer 8s infinite",
      },
      borderRadius: {
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)"
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--bits-accordion-content-height)" }
        },
        "accordion-up": {
          from: { height: "var(--bits-accordion-content-height)" },
          to: { height: "0" }
        },
        "caret-blink": {
          "0%,70%,100%": { opacity: "1" },
          "20%,50%": { opacity: "0" }
        },
        spin: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        "flip": {
          "to": {
            "transform": "rotate(360deg)",
          },
        },
        "kitrotate": {
          "to": {
            "transform": "rotate(90deg)",
          },
        },
        shine: {
          from: {
            backgroundPosition: "0 0",
          },
          to: {
            backgroundPosition: "-200% 0",
          },
        },
        "border-width": {
          from: {
            width: "10px",
            opacity: "0",
          },
          to: {
            width: "100px",
            opacity: "1",
          },
        },
        "text-gradient": {
          to: {
            backgroundPosition: "200% center",
          },
        },
        "text-shake": {
          "15%": { transform: "translateX(5px)" },
          "30%": { transform: "translateX(-5px)" },
          "50%": { transform: "translateX(3px)" },
          "80%": { transform: "translateX(2px)" },
          "100%": { transform: "translateX(0)" },
        },
        "text-glitch-to": {
          from: {
            transform: "translateY(0)",
          },
          to: {
            transform: "translateY(-100%)",
          },
        },
        "text-glitch-from": {
          from: {
            transform: "translateY(100%)",
          },
          to: {
            transform: "translateY(0)",
          },
        },
        "text-scale": {
          "0%": {
            transform: "scaleX(0)",
            transformOrigin: "bottom left",
          },
          "25%": {
            transform: "scaleX(1)",
            transformOrigin: "bottom left",
          },
          "75%": {
            transform: "scaleX(1)",
            transformOrigin: "bottom right",
          },
          "100%": {
            transform: "scaleX(0)",
            transformOrigin: "bottom right",
          },
        },
        slide: {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(calc(-100% - var(--gap)))" },
        },
        spotlight: {
          "0%": {
            opacity: "0",
            transform: "translate(-72%, -62%) scale(0.5)",
          },
          "100%": {
            opacity: "1",
            transform: "translate(-50%,-40%) scale(1)",
          },
        },
        // For Gradient Input, UI-Snippets : https://ui.ibelick.com
        'background-shine': {
          from: { backgroundPosition: '0 0' },
          to: { backgroundPosition: '-200% 0' },
        },
        "aurora-border": {
          "0%, 100%": { borderRadius: "37% 29% 27% 27% / 28% 25% 41% 37%" },
          "25%": { borderRadius: "47% 29% 39% 49% / 61% 19% 66% 26%" },
          "50%": { borderRadius: "57% 23% 47% 72% / 63% 17% 66% 33%" },
          "75%": { borderRadius: "28% 49% 29% 100% / 93% 20% 64% 25%" },
        },
        "aurora-1": {
          "0%, 100%": { top: "0", right: "0" },
          "50%": { top: "50%", right: "25%" },
          "75%": { top: "25%", right: "50%" },
        },
        "aurora-2": {
          "0%, 100%": { top: "0", left: "0" },
          "60%": { top: "75%", left: "25%" },
          "85%": { top: "50%", left: "50%" },
        },
        "aurora-3": {
          "0%, 100%": { bottom: "0", left: "0" },
          "40%": { bottom: "50%", left: "25%" },
          "65%": { bottom: "25%", left: "50%" },
        },
        "aurora-4": {
          "0%, 100%": { bottom: "0", right: "0" },
          "50%": { bottom: "25%", right: "40%" },
          "90%": { bottom: "50%", right: "25%" },
        },
        gradient: {
          to: {
            "background-position": "200% center",
          },
        },
        shimmer: {
          "0%, 90%, 100%": {
            "background-position": "calc(-100% - var(--shimmer-width)) 0",
          },
          "30%, 60%": {
            "background-position": "calc(100% + var(--shimmer-width)) 0",
          },
        },
        "border-beam": {
          "100%": {
            "offset-distance": "100%",
          },
        },
        "shine-pulse": {
          "0%": {
            "background-position": "0% 0%",
          },
          "50%": {
            "background-position": "100% 100%",
          },
          to: {
            "background-position": "0% 0%",
          },
        },
        grid: {
          "0%": { transform: "translateY(-50%)" },
          "100%": { transform: "translateY(0)" },
        },
        ripple: {
          "0%, 100%": {
            transform: "translate(-50%, -50%) scale(1)",
          },
          "50%": {
            transform: "translate(-50%, -50%) scale(0.9)",
          },
        },
        "spin-around": {
          "0%": {
            transform: "translateZ(0) rotate(0)",
          },
          "15%, 35%": {
            transform: "translateZ(0) rotate(90deg)",
          },
          "65%, 85%": {
            transform: "translateZ(0) rotate(270deg)",
          },
          "100%": {
            transform: "translateZ(0) rotate(360deg)",
          },
        },
        magicslide: {
          to: {
            transform: "translate(calc(100cqw - 100%), 0)",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "caret-blink": "caret-blink 1.25s ease-out infinite",
        "flip": "flip 6s infinite steps(2, end)",
        "kitrotate": "kitrotate 3s linear infinite both",
        shine: "shine 2s linear infinite",
        slide: "slide 40s linear infinite",
        spotlight: "spotlight 2s ease .75s 1 forwards",
        "border-width": "border-width 3s infinite alternate",
        "text-gradient": "text-gradient 2s linear infinite",
        "text-shake": "text-shake 1s ease 1",
        "text-glitch-to": "text-glitch-to 0.6s ease-in-out infinite",
        "text-glitch-from": "text-glitch-from 0.6s ease-in-out infinite",
        "text-scale": "text-scale 1s linear infinite forwards",
        'spin': 'spin 2s linear infinite',
        'background-shine': 'background-shine 2s linear infinite',
        'pulse-slow': 'pulse 6s infinite cubic-bezier(0.4, 0, 0.6, 1)',
        "border-beam": "border-beam calc(var(--duration)*1s) infinite linear",
        grid: "grid 15s linear infinite",
        ripple:'ripple var(--duration,2s) ease calc(var(--i, 0)*.2s) infinite',
        "spin-around": "spin-around calc(var(--speed) * 2) infinite linear",
        magicslide: "magicslide var(--speed) ease-in-out infinite alternate",
      },
      typography: {
        DEFAULT: {
          css: {
            maxWidth: "100%"
          }
        }
      }
    }
  },
  plugins: [tailwindcssAnimate]
};

export default config;