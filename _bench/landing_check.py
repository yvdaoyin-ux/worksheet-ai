import re, glob, os
files = sorted(glob.glob("worksheets/*/index.html"))
probs = []
for f in files:
    h = open(f, encoding="utf-8").read()
    slug = f.replace("\\", "/").split("/")[1]
    if "<title>" not in h: probs.append((slug, "no-title"))
    if 'name="description"' not in h: probs.append((slug, "no-meta-desc"))
    if "sample-worksheet" not in h: probs.append((slug, "no-sample"))
    if "data-subject" not in h: probs.append((slug, "no-data-subject"))
    if re.search(r">(undefined|NaN|TODO|null)<", h): probs.append((slug, "js-artifact"))
    for m in re.finditer(r'href="(/worksheets/[^"]*?/|/)"', h):
        t = m.group(1).strip("/")
        if t and not os.path.isdir(t.replace("/", os.sep)):
            probs.append((slug, "dead-link:" + m.group(1)))
sm = open("sitemap.xml", encoding="utf-8").read()
locs = re.findall(r"<loc>[^<]+/worksheets/([^<]+)/</loc>", sm)
disk = {f.replace("\\", "/").split("/")[1] for f in files}
missing = [s for s in locs if s not in disk]
extra = [s for s in disk if s not in locs]
print("pages:", len(files), "| sitemap urls:", len(locs), "| sitemap-not-on-disk:", missing or "none", "| disk-not-in-sitemap:", extra or "none")
print("problems:", probs or "NONE")
