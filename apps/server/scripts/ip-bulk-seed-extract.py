#!/usr/bin/env python3
"""
IP bulk-seed — Phase 0 extractor (runs LOCALLY, where the .xlsx lives).

The source workbook has a single column `图片提示词`: one free-text image prompt
per row. The 片名 (title) and 改编方向 (synopsis) are embedded in the prose. This
script extracts them into a dependency-free rows.json that the TS seed script
(ip-bulk-seed.ts) consumes inside the .com pod — so no xlsx parser is needed
server-side and the prompts never depend on the local machine at write time.

Usage:
  python3 apps/server/scripts/ip-bulk-seed-extract.py "/path/to/IP项目目录_100-207_图片提示词.xlsx2.xlsx"
Writes: apps/server/outputs/ip-bulk-seed/rows.json
"""
import sys, os, re, json, zipfile, xml.etree.ElementTree as ET

NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
T = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t"
CATALOG_START = 100  # workbook is "100-207" → number rows 100,101,…

TITLE_RE = re.compile(r"片名[:：]\s*([^。,，\n]+)")
ADAPT_RE = re.compile(r"改编方向[:：]\s*(.+)", re.S)
LANG_RE = re.compile(r"([一-鿿]{1,6})文?和英文双语")


def cell_value(c, shared):
    v = c.find("a:v", NS)
    if v is None:
        return ""
    return shared[int(v.text)] if c.get("t") == "s" else (v.text or "")


def main():
    if len(sys.argv) < 2:
        print("usage: ip-bulk-seed-extract.py <xlsx>", file=sys.stderr)
        sys.exit(2)
    path = sys.argv[1]
    z = zipfile.ZipFile(path)
    shared = [
        "".join(t.text or "" for t in si.iter(T))
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("a:si", NS)
    ]
    sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    rows = sheet.findall(".//a:row", NS)

    out = []
    skipped = []
    idx = 0
    for r in rows[1:]:  # skip header
        c = r.find("a:c", NS)
        prompt = (cell_value(c, shared) if c is not None else "").strip()
        if not prompt:
            continue
        mt, ma, ml = TITLE_RE.search(prompt), ADAPT_RE.search(prompt), LANG_RE.search(prompt)
        title = mt.group(1).strip() if mt else ""
        summary = ma.group(1).strip() if ma else ""
        if not title:
            skipped.append(idx)
        out.append(
            {
                "catalogNo": CATALOG_START + idx,
                "title": title,
                "summary": summary,
                "posterLang": (ml.group(1) + "文") if ml else None,
                "prompt": prompt,
            }
        )
        idx += 1

    dest_dir = os.path.join(os.path.dirname(__file__), "..", "outputs", "ip-bulk-seed")
    os.makedirs(dest_dir, exist_ok=True)
    dest = os.path.abspath(os.path.join(dest_dir, "rows.json"))
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    titles = sum(1 for r in out if r["title"])
    summaries = sum(1 for r in out if r["summary"])
    uniq = len({r["title"] for r in out if r["title"]})
    print(f"rows={len(out)} title={titles} summary={summaries} unique_titles={uniq} skipped_title={skipped}")
    print(f"wrote {dest}")
    for r in out[:3]:
        print(f"  [{r['catalogNo']}] {r['title']}  ({r['posterLang']})  — {r['summary'][:40]}…")


if __name__ == "__main__":
    main()
