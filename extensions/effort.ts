import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const EFFORT_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

type EffortLevel = (typeof EFFORT_LEVELS)[number];

function isEffortLevel(value: string): value is EffortLevel {
  return EFFORT_LEVELS.includes(value as EffortLevel);
}

export default function effortExtension(pi: ExtensionAPI): void {
  pi.registerCommand("effort", {
    description: "Set reasoning effort; use /effort next to cycle",
    getArgumentCompletions: (prefix) => {
      const values = ["next", ...EFFORT_LEVELS];
      const matches = values.filter((value) => value.startsWith(prefix.toLowerCase()));
      return matches.length > 0
        ? matches.map((value) => ({ value, label: value }))
        : null;
    },
    handler: async (args, ctx) => {
      const available = ctx.model
        ? getSupportedThinkingLevels(ctx.model)
        : (["off"] as EffortLevel[]);
      const current = pi.getThinkingLevel();
      const argument = args.trim().toLowerCase();

      let requested: EffortLevel | undefined;

      if (argument === "next") {
        const currentIndex = available.indexOf(current);
        requested = available[(currentIndex + 1) % available.length];
      } else if (argument === "") {
        if (!ctx.hasUI) return;
        const selected = await ctx.ui.select(
          `Reasoning effort (current: ${current})`,
          available.map((level) => (level === current ? `${level} (current)` : level)),
        );
        requested = selected?.replace(" (current)", "") as EffortLevel | undefined;
        if (!requested) return;
      } else if (isEffortLevel(argument)) {
        requested = argument;
      } else {
        ctx.ui.notify(
          `Unknown effort "${argument}". Use: ${EFFORT_LEVELS.join(", ")}, next`,
          "error",
        );
        return;
      }

      if (!available.includes(requested)) {
        ctx.ui.notify(
          `${ctx.model?.id ?? "Current model"} does not support ${requested}. Available: ${available.join(", ")}`,
          "warning",
        );
        return;
      }

      pi.setThinkingLevel(requested);
      ctx.ui.notify(`Reasoning effort: ${pi.getThinkingLevel()}`, "info");
    },
  });
}
