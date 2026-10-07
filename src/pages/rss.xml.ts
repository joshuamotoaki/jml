import rss from "@astrojs/rss";
import type { APIRoute } from "astro";
import { getPosts } from "../lib/blog";

export const GET: APIRoute = async (context) => {
  const posts = await getPosts();

  return rss({
    title: "Joshua Motoaki Lau — Blog",
    description:
      "Writing about systems and style, both technical and human and the intersection of the two.",
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
