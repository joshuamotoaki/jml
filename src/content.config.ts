import { defineCollection, z } from "astro:content";

const blog = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    tags: z.array(z.string().min(1)),
    permalink: z
      .string()
      .trim()
      .min(1)
      .refine((value) => !value.startsWith("/") && !value.endsWith("/"), {
        message: "permalink cannot start or end with '/'.",
      })
      .refine((value) => !/\s/.test(value), {
        message: "permalink cannot contain spaces.",
      })
      .refine((value) => !value.includes("//"), {
        message: "permalink cannot contain empty path segments.",
      }),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog };
