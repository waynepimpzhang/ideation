#!/usr/bin/env python3
"""Build docs/cards.json and refs/INDEX.md from refs/*.md.

Usage: python scripts/build.py
Standard library only. Idempotent apart from the generated_at timestamp.
"""
import json
import re
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REFS = ROOT / "refs"
DOCS = ROOT / "docs"
PATTERNS_MD = Path.home() / ".claude" / "skills" / "aic-ideation" / "library" / "patterns.md"
# Optional in-repo copy wins if present (e.g. for CI): refs/patterns.md or scripts/patterns.md
for alt in (ROOT / "scripts" / "patterns.md", ROOT / "refs" / "patterns.md"):
    if alt.exists():
        PATTERNS_MD = alt
        break

LIST_FIELDS = {"patterns"}
OPEN_BR, CLOSE_BR = "（([【", "）)]】"


def split_top(s, seps="、,，;；/／"):
    """Split on separators outside brackets."""
    out, depth, cur = [], 0, ""
    for ch in s:
        if ch in OPEN_BR:
            depth += 1
        elif ch in CLOSE_BR:
            depth = max(0, depth - 1)
        if ch in seps and depth == 0:
            out.append(cur)
            cur = ""
        else:
            cur += ch
    out.append(cur)
    return [x.strip() for x in out if x.strip()]


def strip_paren(s):
    return re.sub(r"[（(【\[].*?[）)】\]]", "", s).strip()


def facet(value):
    """Facet labels: split on separators, drop parenthetical detail, dedupe."""
    items = []
    for part in split_top(value or ""):
        label = strip_paren(part) or part
        if label and label not in items:
            items.append(label)
    return items


def parse_list(v):
    v = v.strip()
    if v.startswith("[") and v.endswith("]"):
        v = v[1:-1]
    elif v.startswith("［") and v.endswith("］"):
        v = v[1:-1]
    return [x.strip().strip("'\"「」") for x in split_top(v, ",，、;；") if x.strip()]


def parse_card(path):
    text = path.read_text(encoding="utf-8-sig").replace("\r\n", "\n")
    fm, body = {}, text
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", text, re.S)
    if m:
        for line in m.group(1).split("\n"):
            km = re.match(r"^([\w\-]+)\s*[:：]\s*(.*)$", line.strip())
            if not km:
                continue
            k, v = km.group(1).strip(), km.group(2).strip()
            fm[k] = parse_list(v) if k in LIST_FIELDS else v.strip("'\"")
        body = m.group(2)
    body = body.strip("\n")
    hm = re.search(r"^#\s+(.+)$", body, re.M)
    title = hm.group(1).strip() if hm else fm.get("case", path.stem)
    for k in LIST_FIELDS:
        fm.setdefault(k, [])
    one = re.search(r"\*\*一句話\*\*\s*[:：]\s*(.+)", body)
    am = re.search(r"(?:AI\s*)?可行性\s*[:：]?\s*(中高|高|中|低)", body)
    card = {"slug": path.stem, "title": title}
    card.update(fm)
    card["body_md"] = body
    card["one_liner"] = one.group(1).strip() if one else None
    card["ai_feasibility"] = am.group(1) if am else None
    card["facets"] = {
        "industry": facet(fm.get("industry", "")),
        "form": facet(fm.get("form", "")),
        "spec": facet(fm.get("spec", "")),
        "tone": facet(fm.get("tone", "")),
        "patterns": list(fm.get("patterns", [])),
    }
    return card


def date_key(c):
    m = re.match(r"(\d{4})\D+(\d{1,2})(?:\D+(\d{1,2}))?", str(c.get("date", "")))
    if not m:
        return (0, 0, 0)
    return tuple(int(x) if x else 0 for x in m.groups())


def parse_patterns():
    if not PATTERNS_MD.exists():
        print(f"warn: patterns file not found: {PATTERNS_MD}", file=sys.stderr)
        return []
    rows = []
    for line in PATTERNS_MD.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) < 5 or cells[0] in ("手法",) or set(cells[0]) <= set("-: "):
            continue
        # cells[3] is 出處 (confidential) and is deliberately dropped.
        rows.append({"name": cells[0], "structure": cells[1], "tone": cells[2], "apply_to": cells[4]})
    return rows


def cell(s):
    return str(s or "").replace("|", "／").replace("\n", " ")


def write_index(cards):
    lines = [
        "<!-- 此檔由 scripts/build.py 自動產生，請勿手動編輯。 -->",
        "",
        "# 案例索引",
        "",
        "此檔由 scripts/build.py 自動產生，請勿手動編輯。重新產生：`python scripts/build.py`",
        "",
        "| 日期 | 案例 | 產業 | 規格 | 形式 | 手法 | 卡片 |",
        "|---|---|---|---|---|---|---|",
    ]
    for c in cards:
        lines.append("| " + " | ".join([
            cell(c.get("date")), cell(c.get("case") or c["title"]), cell(c.get("industry")),
            cell(c.get("spec")), cell(c.get("form")), cell("、".join(c.get("patterns", []))),
            f"[{c['slug']}.md]({c['slug']}.md)",
        ]) + " |")
    (REFS / "INDEX.md").write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


def main():
    cards = []
    for p in sorted(REFS.glob("*.md")):
        if p.name.upper() in ("INDEX.MD", "README.MD"):
            continue
        try:
            cards.append(parse_card(p))
        except Exception as e:  # tolerant: skip a broken card, keep building
            print(f"warn: {p.name}: {e}", file=sys.stderr)
    cards.sort(key=lambda c: (date_key(c), c["slug"]), reverse=True)
    patterns = parse_patterns()
    tz = timezone(timedelta(hours=8))
    data = {
        "generated_at": datetime.now(tz).strftime("%Y-%m-%d %H:%M (UTC+8)"),
        "count": len(cards),
        "cards": cards,
        "patterns": patterns,
    }
    DOCS.mkdir(exist_ok=True)
    (DOCS / "cards.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8", newline="\n")
    write_index(cards)
    print(f"built {len(cards)} cards, {len(patterns)} patterns -> docs/cards.json, refs/INDEX.md")


if __name__ == "__main__":
    main()
