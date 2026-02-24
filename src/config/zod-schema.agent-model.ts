import { z } from "zod";

export const AgentModelSchema = z.union([
  z.string(),
  z
    .object({
      primary: z.string().optional(),
      fallbacks: z.array(z.string()).optional(),
      routing: z
        .object({
          enabled: z.boolean().optional(),
          rules: z
            .array(
              z.object({
                when: z.union([
                  z.literal("simple"),
                  z.literal("tool_heavy"),
                  z.literal("reasoning"),
                  z.literal("code"),
                ]),
                prefer: z.string(),
              }),
            )
            .optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
]);
