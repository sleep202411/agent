export type DocumentEpisode = { number: number; label: string; title: string };

function chineseNumber(text: string): number {
  if (/^\d+$/.test(text)) return Number(text);
  const digits = '零一二三四五六七八九';
  let result = 0,
    digit = 0;
  for (const char of text.replaceAll('两', '二').replaceAll('〇', '零')) {
    const unit = ({ 十: 10, 百: 100, 千: 1000 } as Record<string, number>)[
      char
    ];
    if (unit) {
      result += (digit || 1) * unit;
      digit = 0;
    } else digit = digits.indexOf(char);
  }
  return result + digit;
}

/** Only explicit heading lines establish episode scope; never infer it from
 * dialogue mentioning another episode or from an AI-supplied episode number. */
export function documentEpisodeSections(source: string) {
  const text = source.normalize('NFKC');
  const headings = [
    ...text.matchAll(
      /^(?:[ \t]*(?:第[一二三四五六七八九十百千零〇两\d]+季[·\s:：-]*)?)(第([一二三四五六七八九十百千零〇两\d]+)集|Episode\s+(\d+))(?=[\s:：·—《(-]|$)([^\n]*)/gim,
    ),
  ];
  const sections: { text: string; episode?: DocumentEpisode }[] = [];
  if (!headings.length) return [{ text }];
  if (headings[0].index > 0)
    sections.push({ text: text.slice(0, headings[0].index) });
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const number = chineseNumber(h[2] ?? h[3]);
    if (number < 1 || number > 10000)
      throw new Error('Unsupported screenplay episode number.');
    const label = h[1];
    const title =
      h[4]
        .replace(/^[\s:：·—-]+/, '')
        .replace(/\s*[（(](?:时长|時長|duration).*$/i, '')
        .trim()
        .replace(/^《(.*)》$/, '$1')
        .replace(/^\((.*)\)$/, '$1')
        .trim()
        .slice(0, 180) || label;
    sections.push({
      text: text.slice(h.index, headings[i + 1]?.index),
      episode: { number, label, title },
    });
  }
  return sections;
}
