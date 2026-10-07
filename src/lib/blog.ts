import { getCollection } from "astro:content";

/** Posts newest first. Drafts are only included in dev. */
export async function getPosts() {
  const includeDrafts = !import.meta.env.PROD;
  return (await getCollection("blog"))
    .filter((post) => includeDrafts || !post.data.draft)
    .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}
