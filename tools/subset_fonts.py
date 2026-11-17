#!/usr/bin/env python3
"""把字體切成「只含這一頁用到的字」的小檔，輸出內嵌用的 @font-face CSS。

由 build-fonts.js 呼叫，一般不需要單獨執行：
    python3 subset_fonts.py <@fontsource 目錄> <roles.json>   →  CSS 印到 stdout

roles.json 長這樣： {"Receipt Serif|900": "新金進五金行…", "Receipt Hand|700": "…"}
"""
import base64
import glob
import io
import json
import os
import re
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

# 頁面上的字體名稱 → @fontsource 套件
PACKAGES = {
    "Receipt Serif": "noto-serif-tc",   # Noto Serif TC（SIL OFL 1.1）
    "Receipt Hand": "lxgw-wenkai-tc",   # LXGW WenKai TC 霞鶩文楷（SIL OFL 1.1）
}


def natural(path):
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", os.path.basename(path))]


def source_files(src, pkg, weight):
    """先找繁中主檔與拉丁檔，找不到的字（例如全形標點）再去翻編號分片。"""
    folder = os.path.join(src, pkg, "files")
    first = [
        os.path.join(folder, f"{pkg}-chinese-traditional-{weight}-normal.woff2"),
        os.path.join(folder, f"{pkg}-latin-{weight}-normal.woff2"),
    ]
    numbered = sorted(glob.glob(os.path.join(folder, f"{pkg}-[0-9]*-{weight}-normal.woff2")), key=natural)
    return [p for p in first if os.path.exists(p)] + numbered


def make_subset(path, codepoints):
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = []        # 不需要 OpenType 排版特性，檔案才會小
    options.name_IDs = [0, 13, 14]      # 保留著作權與授權資訊
    options.hinting = False
    options.notdef_outline = True
    font = TTFont(path, lazy=True)
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=codepoints)
    subsetter.subset(font)
    out = io.BytesIO()
    font.flavor = "woff2"
    font.save(out)
    return out.getvalue()


def unicode_range(codepoints):
    cps = sorted(codepoints)
    parts, start, prev = [], cps[0], cps[0]
    for cp in cps[1:] + [None]:
        if cp is not None and cp == prev + 1:
            prev = cp
            continue
        parts.append(f"U+{start:X}" if start == prev else f"U+{start:X}-{prev:X}")
        if cp is not None:
            start = prev = cp
    return ",".join(parts)


def main():
    src, roles_path = sys.argv[1], sys.argv[2]
    with open(roles_path, encoding="utf-8") as fh:
        roles = json.load(fh)

    css, report = [], []
    for role in sorted(roles):
        family, weight = role.split("|")
        wanted = {ord(ch) for ch in roles[role] if not ch.isspace()}
        if not wanted:
            continue
        files = source_files(src, PACKAGES[family], weight)
        if not files:
            sys.exit(f"找不到字體檔：{family} {weight}（{src}）")
        remaining, total = set(wanted), 0
        for path in files:
            if not remaining:
                break
            cmap = TTFont(path, lazy=True).getBestCmap()
            take = remaining & set(cmap)
            if not take:
                continue
            data = make_subset(path, take)
            total += len(data)
            css.append(
                '@font-face{font-family:"%s";font-weight:%s;font-style:normal;font-display:block;'
                'src:url(data:font/woff2;base64,%s) format("woff2");unicode-range:%s}'
                % (family, weight, base64.b64encode(data).decode("ascii"), unicode_range(take))
            )
            remaining -= take
        if remaining:
            sys.exit(f"{family} {weight} 缺字：{''.join(chr(c) for c in sorted(remaining))}")
        report.append(f"{family} {weight}: {len(wanted)} 字, {total / 1024:.1f} KB")

    sys.stderr.write("\n".join(report) + "\n")
    sys.stdout.write("\n".join(css) + "\n")


if __name__ == "__main__":
    main()
