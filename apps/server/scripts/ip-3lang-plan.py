#!/usr/bin/env python3
"""
Build the 3-language poster plan from the trilingual Excel rows.json:
  - dedup by title (keep first)
  - drop Req3 excludes (flagship IPs with curated hero posters)
  - Req2: fix wrong "display language" names in the prompt (country/city -> real language)
  - resolve IP identity by TITLE: reuse the existing IP id (prev-108 run) so overlaps
    UPDATE instead of creating duplicates; new titles get a fresh title-keyed id.
Writes outputs/ip-bulk-seed/plan-3lang.json + prints a report (no DB, no network).
"""
import json, re, hashlib, os

BASE = os.path.join(os.path.dirname(__file__), "..", "outputs", "ip-bulk-seed")
rows = json.load(open(os.path.join(BASE, "rows.json")))
prev = json.load(open(os.path.join(BASE, "prev-108", "results.json")))
prev_by_title = {r["title"]: r for r in prev if r.get("status") == "created"}

EXCLUDE = {"火壤星洲", "格萨尔王", "月亮与六便士"}  # Req3: flagship hero IPs

# Req2: place/country/wrong name (as it appears, "<x>文") -> correct language name
LANG_FIX = {
    # Spanish-speaking
    "墨西哥文": "西班牙文", "古巴文": "西班牙文", "阿根廷文": "西班牙文", "智利文": "西班牙文",
    "秘鲁文": "西班牙文", "哥伦比亚文": "西班牙文", "委内瑞拉文": "西班牙文", "玻利维亚文": "西班牙文",
    # Portuguese
    "巴西文": "葡萄牙文",
    # Arabic
    "埃及文": "阿拉伯文", "沙特文": "阿拉伯文", "阿联酋文": "阿拉伯文", "摩洛哥文": "阿拉伯文",
    "伊拉克文": "阿拉伯文", "约旦文": "阿拉伯文", "黎巴嫩文": "阿拉伯文", "卢克索文": "阿拉伯文", "开罗文": "阿拉伯文",
    # Persian / others
    "伊朗文": "波斯文",
    "肯尼亚文": "斯瓦希里文", "坦桑尼亚文": "斯瓦希里文",
    "尼日利亚文": "英文", "加纳文": "英文", "爱尔兰文": "英文", "新西兰文": "英文", "澳大利亚文": "英文",
    "贝宁文": "法文", "刚果文": "法文", "塞内加尔文": "法文", "科特迪瓦文": "法文", "喀麦隆文": "法文",
    "瑞士文": "德文", "奥地利文": "德文",
    "比利时文": "荷兰文",
    # South / SE Asia
    "印度文": "印地文", "印度尼西亚文": "印尼文", "马来西亚文": "马来文",
    "菲律宾文": "他加禄文", "柬埔寨文": "高棉文",
    # cities -> country language
    "孟买文": "印地文", "德里文": "印地文", "加尔各答文": "孟加拉文",
    "曼谷文": "泰文", "清迈文": "泰文", "九龙文": "繁体中文", "香港文": "繁体中文",
    "里约文": "葡萄牙文", "圣保罗文": "葡萄牙文",
    # Senegal/Dakar (must precede any substring match) -> French
    "塞内加尔达喀文": "法文", "塞内加尔文": "法文", "达喀尔文": "法文",
    # generic "印文" (all India-set rows) -> Hindi
    "印文": "印地文",
    # noise
    "中英文": "中文和英文", "当代中文": "中文", "清代科举文": "", "科举文": "",
}
GOOD = {"中文", "英文", "繁体中文", "日文", "韩文", "泰文", "越南文", "印尼文", "马来文", "他加禄文",
        "缅甸文", "高棉文", "老挝文", "孟加拉文", "印地文", "泰米尔文", "乌尔都文", "尼泊尔文",
        "波斯文", "阿拉伯文", "希伯来文", "土耳其文", "俄文", "乌克兰文", "哈萨克文", "蒙古文",
        "法文", "德文", "西班牙文", "葡萄牙文", "意大利文", "荷兰文", "希腊文", "波兰文", "罗马尼亚文",
        "匈牙利文", "捷克文", "瑞典文", "挪威文", "丹麦文", "芬兰文", "斯瓦希里文", "豪萨文", "约鲁巴文"}

def fix_prompt(p):
    s = p
    # longest keys first so e.g. 塞内加尔达喀文 is fixed before any substring
    for k, v in sorted(LANG_FIX.items(), key=lambda kv: -len(kv[0])):
        s = s.replace(k, v)
    s = s.replace("文文", "文")  # 中文文 / 越南文文 -> ...
    return s

def third_langs(prompt):
    m = re.search(r"。(.*?)显示", prompt)
    if not m:
        return []
    out = []
    for part in re.split(r"[、和，,]", m.group(1)):
        mm = re.match(r"^([一-龥]{1,6}?[文语])", part.strip())
        if mm:
            t = mm.group(1)
            if t not in ("中文", "英文", "双语", "三语", "多语", "语"):
                out.append(t)
    return out

def seed_uuid(kind, key):
    h = hashlib.sha1(f"ip-bulk-seed:{kind}:{key}".encode()).hexdigest()
    b = list(h[:32])
    b[12] = "5"
    b[16] = format((int(b[16], 16) & 0x3) | 0x8, "x")
    s = "".join(b)
    return f"{s[:8]}-{s[8:12]}-{s[12:16]}-{s[16:20]}-{s[20:]}"

seen, plan, excluded, unmapped = set(), [], [], {}
for r in rows:
    t = r["title"]
    if t in EXCLUDE:
        excluded.append(t); continue
    if t in seen:
        continue
    seen.add(t)
    cleaned = fix_prompt(r["prompt"])
    for tok in third_langs(cleaned):
        if tok not in GOOD:
            unmapped[tok] = unmapped.get(tok, 0) + 1
    prevrow = prev_by_title.get(t)
    if prevrow:
        ip_id, cover_id, mode = prevrow["ipId"], prevrow["coverAssetId"], "update"
    else:
        ip_id, cover_id, mode = seed_uuid("ip3", t), seed_uuid("media3", t), "create"
    plan.append({
        "catalogNo": r["catalogNo"], "title": t, "summary": r["summary"],
        "prompt": cleaned, "ipId": ip_id, "coverAssetId": cover_id, "mode": mode,
    })

json.dump(plan, open(os.path.join(BASE, "plan-3lang.json"), "w"), ensure_ascii=False, indent=2)
upd = sum(1 for p in plan if p["mode"] == "update")
print(f"plan rows: {len(plan)}  (update={upd}  create={len(plan)-upd})")
print(f"excluded (Req3): {excluded}")
print(f"dedup dropped: {len(rows) - len(plan) - len(excluded)} dup rows")
print(f"UNMAPPED 3rd-lang tokens still not in GOOD list (need a fix): {dict(sorted(unmapped.items(), key=lambda x:-x[1]))}")
print("--- sample cleaned prompts ---")
for p in plan[:2]:
    print(f"[{p['mode']}] {p['title']}: {p['prompt'][:120]}")
