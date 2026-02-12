import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import type { APIRoute } from "astro";

export const GET: APIRoute = async (context) => {
  const includeDrafts = !import.meta.env.PROD;
  const posts = (await getCollection("blog"))
    .filter((post) => includeDrafts || !post.data.draft)
    .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());

  return rss({
    title: "Joshua Motoaki Lau — Blog",
    description: "Writing on software, systems, and engineering craft.",
    site: context.site ?? "https://motoaki.dev",
    customData: "<language>en-us</language>",
    xmlns: {
      atom: "http://www.w3.org/2005/Atom",
    },
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: `/blog/${post.data.permalink}/`,
      categories: post.data.tags,
      customData: post.data.updatedDate
        ? `<atom:updated>${post.data.updatedDate.toISOString()}</atom:updated>`
        : undefined,
    })),
  });
};
