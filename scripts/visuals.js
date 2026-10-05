// scripts/visuals.js
// Renders the app's `data-visual` placeholders into STATIC markup at build time.
//
// WHY THIS IS NEEDED
// The AI emits placeholders like:
//   <div class="ws-visual" data-visual="fraction-bar" data-num="3" data-den="4"></div>
// and /app.js fills them in at runtime. That is fine inside the app, but a
// sample worksheet embedded into a static SEO page has two problems:
//   1. `.ws-visual:empty { display:none }` means an un-hydrated placeholder
//      renders as NOTHING - the question ("what fraction is shaded?") would
//      reference a picture that isn't there.
//   2. Google indexes the HTML, not the post-JS DOM, so the artwork and the
//      question context would be invisible to search.
// So we render the same markup the browser would have produced, and bake it in.
//
// NOTE: this mirrors the builders in app.js (which cannot be required from Node
// because it is a browser IIFE). Keep the markup class names in sync with
// app.css - they are the contract between the two.
// (Item types: number-line, fraction-bar, fraction-circle, ten-frame, array,
//  place-value, vertical, organizer.)

function gcd(a, b) { return b ? gcd(b, a % b) : a; }

function fracSpan(a, b) {
  return '<span class="frac"><span class="num">' + a + '</span><span class="den">' + b + "</span></span>";
}

function fracLabel(num, den) {
  const g = gcd(num, den);
  const n = num / g, d = den / g;
  if (d === 1) return String(n);
  return fracSpan(n, d);
}

function numberLine(o) {
  const ticks = o.ticks > 0 ? o.ticks : 1;
  let html = '<div class="viz viz-numline"><span class="nl-line"></span>';
  for (let i = 0; i <= ticks; i++) {
    const pct = (i / ticks) * 100;
    const val = o.min + ((o.max - o.min) * i) / ticks;
    let label;
    if (Number.isInteger(val)) label = String(val);
    else if (o.min === 0 && o.max === 1) label = fracLabel(i, ticks);
    else label = String(Math.round(val * 100) / 100);
    html += '<span class="nl-tick" style="left:' + pct + '%"></span>';
    html += '<span class="nl-label" style="left:' + pct + '%">' + label + "</span>";
  }
  (o.points || []).forEach((p) => {
    const parts = String(p).split(":");
    const v = parseFloat(parts[0]);
    if (isNaN(v) || o.max === o.min) return;
    const pct = ((v - o.min) / (o.max - o.min)) * 100;
    if (pct < -5 || pct > 105) return;
    html += '<span class="nl-point" style="left:' + pct + '%">' +
      (parts[1] ? "<em>" + parts[1] + "</em>" : "") + "</span>";
  });
  return html + "</div>";
}

function fractionBar(o) {
  let segs = "";
  for (let i = 0; i < o.den; i++) segs += '<span class="bar-seg' + (i < o.num ? " filled" : "") + '"></span>';
  return '<div class="viz viz-bar"><div class="bar">' + segs + "</div></div>";
}

function fractionCircle(o) {
  const size = 120, r = 52, cx = 60, cy = 60;
  let slices = "";
  for (let i = 0; i < o.den; i++) {
    const a0 = (i / o.den) * 2 * Math.PI - Math.PI / 2;
    const a1 = ((i + 1) / o.den) * 2 * Math.PI - Math.PI / 2;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const d = "M " + cx + " " + cy + " L " + x0 + " " + y0 +
      " A " + r + " " + r + " 0 " + large + " 1 " + x1 + " " + y1 + " Z";
    slices += '<path d="' + d + '" class="pie-slice' + (i < o.num ? " filled" : "") + '"/>';
  }
  return '<div class="viz viz-circle"><svg viewBox="0 0 ' + size + " " + size + '" width="120" height="120" role="img" aria-label="Fraction circle">' + slices + "</svg></div>";
}

function tenFrame(o) {
  const count = Math.max(0, o.count);
  const frames = count > 10 ? 2 : 1;
  let remaining = count, out = "";
  for (let f = 0; f < frames; f++) {
    let cells = "";
    for (let i = 0; i < 10; i++) cells += '<span class="tf-cell' + (i < remaining ? " filled" : "") + '"></span>';
    remaining -= 10;
    out += '<div class="tf-frame">' + cells + "</div>";
  }
  return '<div class="viz viz-tenframe">' + out + "</div>";
}

function array(o) {
  let cells = "";
  for (let i = 0; i < o.rows * o.cols; i++) cells += '<span class="arr-dot"></span>';
  return '<div class="viz viz-array"><div class="arr" style="--cols:' + o.cols + '">' + cells + "</div></div>";
}

function placeValue(o) {
  const digits = String(o.number).replace(/\D/g, "").padStart(3, "0").slice(-3).split("");
  const heads = ["Hundreds", "Tens", "Ones"].map((h) => "<th>" + h + "</th>").join("");
  const cells = digits.map((d) => "<td>" + d + "</td>").join("");
  return '<div class="viz viz-pv"><table><thead><tr>' + heads + "</tr></thead><tbody><tr>" + cells + "</tr></tbody></table></div>";
}

function vertical(o) {
  const clean = (s) => String(s == null ? "" : s).replace(/[&<>]/g, "");
  const a = clean(o.a).trim();
  const b = clean(o.b).trim();
  const op = clean(o.op).trim() || "+";
  if (!a) return "";
  const w = Math.max(a.length, b.length);
  const line1 = "  " + a.padStart(w, " ");
  const line2 = op + " " + b.padStart(w, " ");
  const rule = "  " + "-".repeat(w) + "-";
  return '<div class="viz viz-vertical"><pre>' + line1 + "\n" + line2 + "\n" + rule + "</pre></div>";
}

function organizer(kind) {
  const k = String(kind || "").toLowerCase();
  let rows;
  if (k.indexOf("story") >= 0) rows = ["Characters", "Setting", "Problem", "Solution"];
  else if (k.indexOf("sequence") >= 0 || k.indexOf("first") >= 0) rows = ["First", "Next", "Then", "Last"];
  else if (k.indexOf("kwl") >= 0) rows = ["K \u2014 What I Know", "W \u2014 What I Want to Know", "L \u2014 What I Learned"];
  else if (k.indexOf("compare") >= 0 || k.indexOf("venn") >= 0) rows = ["Alike", "Different"];
  else rows = ["Main Idea", "Detail 1", "Detail 2", "Detail 3"];
  const boxes = rows
    .map((t) => '<div class="org-box"><span class="org-title">' + t + '</span><span class="org-lines"></span></div>')
    .join("");
  return '<div class="viz viz-organizer">' + boxes + "</div>";
}

function build(type, p, kind) {
  const t = String(type || "").toLowerCase();
  if (t.indexOf("organizer") >= 0 || t.indexOf("graphic") >= 0) return organizer(kind);
  if (t.indexOf("vertical") >= 0 || t.indexOf("column") >= 0) return vertical(p);
  if (t.indexOf("line") >= 0) return numberLine(p);
  if (t.indexOf("bar") >= 0) return fractionBar(p);
  if (t.indexOf("circle") >= 0 || t.indexOf("pie") >= 0) return fractionCircle(p);
  if (t.indexOf("ten") >= 0) return tenFrame(p);
  if (t.indexOf("array") >= 0) return array(p);
  if (t.indexOf("place") >= 0) return placeValue(p);
  return "";
}

// Mirrors renderMathString() in app.js. The model writes math in LaTeX
// (\frac, \times, \div, \le, \ge, \cdot ...). The browser converts that at
// runtime, but a BAKED sample never goes through the browser - which is exactly
// why the SEO landing pages showed a literal "\frac{1}{2}" instead of a
// fraction. We also strip macros the renderer does not understand (e.g.
// \underline{\hspace{1cm}}) so a stray macro can never leak as raw text.
function renderMathString(input) {
  let t = String(input == null ? "" : input);
  t = t.replace(/\\[\(\)\[\]]/g, "");
  t = t.replace(/\$([^$]+)\$/g, (m, inner) =>
    /[\\=+\u00d7\u00f7]/.test(inner) || /^[\s\d.,]+$/.test(inner) ? inner : m
  );
  t = t.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, (m, a, b) => fracSpan(a, b));
  t = t.replace(/(\d+)\s+(\d+)\s*\/\s*(\d+)/g, (m, w, a, b) => w + " " + fracSpan(a, b));
  t = t.replace(/(^|[^\d/])(\d+)\s*\/\s*(\d+)(?![\d/])/g, (m, pre, a, b) => pre + fracSpan(a, b));
  t = t
    .replace(/\\times/g, "\u00d7")
    .replace(/\\div(?![a-zA-Z])/g, "\u00f7")
    .replace(/\\cdot/g, "\u00b7")
    .replace(/\\le(?![a-zA-Z])/g, "\u2264")
    .replace(/\\ge(?![a-zA-Z])/g, "\u2265")
    .replace(/\\neq/g, "\u2260")
    .replace(/\\pm(?![a-zA-Z])/g, "\u00b1");
  // Spacers first (they nest inside \underline, so they must go before it),
  // then keep the payload of \underline{X}, then drop any leftover command.
  t = t.replace(/\\(?:hspace|vspace|hskip|vskip|quad|qquad|thinspace|enspace|medspace|thickspace)\*?(?:\{[^{}]*\})?/g, " ");
  t = t.replace(/\\(?:underline|textbf|textit|emph|mathrm|text|mbox)\{([^{}]*)\}/g, "$1");
  t = t.replace(/\\(?:left|right|displaystyle|textstyle)\b/g, "");
  t = t.replace(/\\[a-zA-Z]+/g, "");
  return t;
}

// Replaces every <div class="ws-visual" data-*=...></div> with rendered markup,
// then renders any LaTeX in the surrounding text.
function hydrate(html) {
  const withVisuals = String(html || "").replace(
    /<div([^>]*?)class="ws-visual"([^>]*?)>\s*<\/div>/gi,
    (whole, pre, post) => {
      const attrs = pre + " " + post;
      const attr = (name) => {
        const m = attrs.match(new RegExp("data-" + name + '="([^"]*)"', "i"));
        return m ? m[1] : null;
      };
      const num = (name, d) => { const v = parseFloat(attr(name)); return isNaN(v) ? d : v; };
      const int = (name, d) => { const v = parseInt(attr(name), 10); return isNaN(v) ? d : v; };
      const out = build(attr("visual"), {
        min: num("min", 0), max: num("max", 1), ticks: int("ticks", 4),
        points: (attr("points") || "").split(",").map((s) => s.trim()).filter(Boolean),
        num: int("num", 1), den: int("den", 4), count: int("count", 5),
        rows: int("rows", 3), cols: int("cols", 4), number: int("number", 345),
        a: attr("a"), b: attr("b"), op: attr("op"),
      }, attr("kind"));
      return out || whole; // unknown type: leave as-is
    }
  );
  // Render LaTeX AFTER the visual placeholders are gone, so the fraction rules
  // never touch a data-* attribute (e.g. a number-line point label like "1/2").
  return renderMathString(withVisuals);
}

module.exports = { hydrate, renderMathString };
