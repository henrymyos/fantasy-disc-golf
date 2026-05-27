// Pulls a disc-golf news feed and returns the most recent items. We cache
// at the fetch layer (Next data cache, revalidated every 30 minutes) so the
// dashboard doesn't hammer the upstream on every render.

const FEED_URL = "https://ultiworld.com/category/disc-golf-news/feed/";

export type NewsItem = {
  title: string;
  link: string;
  pubDate: string | null;
  source: string;
};

function strip(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function extract(item: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = item.match(re);
  return m ? strip(m[1]) : null;
}

export async function fetchDiscGolfNews(limit = 6): Promise<NewsItem[]> {
  try {
    const res = await fetch(FEED_URL, {
      next: { revalidate: 1800 },
      headers: { "User-Agent": "Mozilla/5.0 DiscFantasy" },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const itemMatches = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    const items: NewsItem[] = [];
    for (const raw of itemMatches.slice(0, limit)) {
      const title = extract(raw, "title");
      const link = extract(raw, "link");
      const pubDate = extract(raw, "pubDate");
      if (title && link) {
        items.push({ title, link, pubDate, source: "Ultiworld" });
      }
    }
    return items;
  } catch {
    return [];
  }
}
