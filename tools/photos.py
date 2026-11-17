#!/usr/bin/env python3
"""把店家拍的原始照片裁切、壓縮成網頁用的 images/*.jpg。

    python3 tools/photos.py <原始照片資料夾>

原始照片（手機拍的 3072×4096 JPG）不放進版本庫，放在店家的 Google 雲端硬碟。
輸出：寬 1000px、JPEG 品質 74、漸進式；不寫入 EXIF（不會帶出拍攝地點、時間、手機型號）。
要換照片或改裁切範圍，改下面的 PHOTOS 再執行一次。
"""
import os
import sys

from PIL import Image, ImageOps

WIDTH = 1000
QUALITY = 74

# 網頁上的檔名 → (原始檔名, 裁切範圍 左, 上, 右, 下；以原始照片的像素計)
PHOTOS = {
    "storefront": ("IMG20261117114918.jpg", (0, 0, 3072, 2355)),     # 店門口
    "pots":       ("IMG20261117111633.jpg", (123, 82, 3072, 2048)),  # 鍋具
    "plates":     ("IMG20261117111641.jpg", (778, 1597, 3072, 3127)),# 餐具碗盤
    "mops":       ("IMG20261117111649.jpg", (614, 1311, 3072, 2949)),# 清潔用具
    "buckets":    ("IMG20261117111646.jpg", (123, 2253, 2458, 3809)),# 生活用品
    "thermos":    ("IMG20261117111628.jpg", (225, 41, 2560, 1597)),  # 保溫保鮮
}


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    src = sys.argv[1]
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "images")
    os.makedirs(out_dir, exist_ok=True)
    for name, (filename, box) in PHOTOS.items():
        im = ImageOps.exif_transpose(Image.open(os.path.join(src, filename))).convert("RGB")
        im = ImageOps.autocontrast(im.crop(box), cutoff=0.4)
        im = im.resize((WIDTH, round(im.height * WIDTH / im.width)), Image.LANCZOS)
        out = os.path.join(out_dir, name + ".jpg")
        im.save(out, "JPEG", quality=QUALITY, optimize=True, progressive=True)
        print(f"{name}.jpg  {im.width}×{im.height}  {os.path.getsize(out) // 1024} KB")


if __name__ == "__main__":
    main()
