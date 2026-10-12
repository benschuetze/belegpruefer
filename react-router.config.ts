import type { Config } from "@react-router/dev/config";
import { vercelPreset } from "@vercel/react-router/vite";

export default {
  ssr: true,
  future: { v8_middleware: true },
  // Only on Vercel: the preset changes the build output, which would break `react-router-serve` locally and in CI.
  presets: process.env.VERCEL ? [vercelPreset()] : [],
} satisfies Config;
