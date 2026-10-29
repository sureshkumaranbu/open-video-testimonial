/**
 * VOC-01: counting words and phrases, without AI. The documents come either
 * from the inbox search index (testimonials: their words as FTS5 indexed
 * them, read through the fts5vocab view of migration 0020) or from survey
 * comments, tokenised here the same way (lower case, accents off, split on
 * anything that isn't a letter or digit). Common words, people's names and
 * tags never count. Pure, so it's unit-tested on its own.
 */

/** Everyday English words that say nothing about a product on their own. */
export const STOPWORDS = new Set(
  (
    "a about above after again against all also am an and any are aren't as at be because been before being below between both but by can can't cannot could " +
    "couldn't did didn't do does doesn't doing don't down during each even ever every few for from further get got had hadn't has hasn't have haven't having he " +
    "her here hers herself him himself his how i i'm i've if in into is isn't it it's its itself just let's like made make many me more most much must my myself " +
    "no nor not now of off on once one only or other our ours ourselves out over own really same she should shouldn't so some such than that that's the their " +
    "theirs them themselves then there there's these they they're this those through to too under until up us use used using very was wasn't we we're we've were " +
    "weren't what what's when where which while who whom why will with won't would wouldn't you you're you've your yours yourself yourselves " +
    "s t ll ve re d m im ive dont didnt doesnt cant wont isnt wasnt thats theyre youre weve also always still well way thing things lot lots bit able " +
    "go going gone come came give gave take took see saw know knew think thought want wanted need needed say said tell told try tried look feel felt " +
    "day days time times year years week weeks month months new good great"
  ).split(/\s+/),
);

/** Words that matter in feedback even though they're common: kept as phrase ends ("easy to use", "great support"). */
const KEEP_IN_PHRASES = new Set(["good", "great", "new", "time", "use", "easy", "support"]);

/** Words of `text` as FTS5's unicode61 tokenizer (remove_diacritics) splits them. */
export function tokenize(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export type Doc = {
  id: string;
  /** Words in order, as indexed. */
  tokens: string[];
  /** Which side of "what they love / what to improve" it's on, by its rating or score. */
  group: "love" | "improve" | null;
};

export type Counted = { label: string; count: number; ids: string[] };

const meaningful = (w: string, skip: Set<string>) => w.length >= 3 && !STOPWORDS.has(w) && !skip.has(w) && !/^\d+$/.test(w);
const phraseEnd = (w: string, skip: Set<string>) => (meaningful(w, skip) || KEEP_IN_PHRASES.has(w)) && !skip.has(w);

function top(map: Map<string, Set<string>>, n: number, min: number): Counted[] {
  return [...map.entries()]
    .filter(([, ids]) => ids.size >= min)
    .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([label, ids]) => ({ label, count: ids.size, ids: [...ids].slice(0, 5) }));
}

/**
 * The words and phrases (two or three words, starting and ending on a word
 * that means something, like "easy to use") the most documents share, each
 * counted once per document, with up to five examples. With few documents a
 * single mention counts; otherwise it takes two.
 */
export function countWords(docs: Doc[], skip: Set<string>, o: { words?: number; phrases?: number } = {}) {
  const words = new Map<string, Set<string>>();
  const phrases = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, k: string, id: string) => {
    let s = m.get(k);
    if (!s) m.set(k, (s = new Set()));
    s.add(id);
  };
  for (const d of docs) {
    const t = d.tokens;
    for (let i = 0; i < t.length; i++) {
      if (meaningful(t[i], skip)) add(words, t[i], d.id);
      if (i + 1 < t.length && phraseEnd(t[i], skip) && phraseEnd(t[i + 1], skip) && (meaningful(t[i], skip) || meaningful(t[i + 1], skip))) add(phrases, `${t[i]} ${t[i + 1]}`, d.id);
      if (i + 2 < t.length && phraseEnd(t[i], skip) && phraseEnd(t[i + 2], skip) && !skip.has(t[i + 1]) && STOPWORDS.has(t[i + 1]) && (meaningful(t[i], skip) || meaningful(t[i + 2], skip))) {
        add(phrases, `${t[i]} ${t[i + 1]} ${t[i + 2]}`, d.id);
      }
    }
  }
  const min = docs.length >= 8 ? 2 : 1;
  return { words: top(words, o.words ?? 20, min), phrases: top(phrases, o.phrases ?? 15, min) };
}

/** Voice of Customer without AI: the top words and phrases overall, and the phrases on each side. */
export function keywordInsights(docs: Doc[], skip: Set<string>) {
  const all = countWords(docs, skip);
  return {
    words: all.words,
    phrases: all.phrases,
    love: countWords(docs.filter((d) => d.group === "love"), skip, { words: 0, phrases: 10 }).phrases,
    improve: countWords(docs.filter((d) => d.group === "improve"), skip, { words: 0, phrases: 10 }).phrases,
  };
}
export type KeywordInsights = ReturnType<typeof keywordInsights>;
