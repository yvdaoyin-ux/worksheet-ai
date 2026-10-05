// lib/curriculum.js
// Grade-level MATH scope for K-5.
//
// WHY THIS FILE EXISTS
// The worksheet generator used to rely on one vague line in the prompt
// ("Match the concepts and difficulty to U.S. standards for this grade").
// A 2026-10-05 benchmark across three different models (gpt-oss-120b,
// deepseek-v4-flash, qwen3.8-27b) showed ALL of them produced correct arithmetic
// but ALL of them drifted a grade ahead — e.g. Grade 3 fractions sheets that
// included fraction addition / subtraction / multiplication, which is Grade 4
// content. The defect is a specification gap, not a model gap.
//
// So: give the model an explicit boundary of what this grade covers and
// (more importantly) what it must NOT contain yet.
//
// NOTE: written in substance aligned to US Common Core, but deliberately WITHOUT
// standard codes (e.g. "3.NF.A.1") — codes are easy to get wrong and the owner
// asked us not to emit them.

const MATH = {
  K: {
    range: "whole numbers 0-20",
    covers: [
      "counting, reading and writing numbers to 20",
      "comparing groups as more / fewer / the same",
      "joining and separating within 10 using objects, fingers or pictures",
      "teen numbers shown as 10 + n",
      "naming basic 2-D shapes (circle, square, triangle, rectangle, hexagon) and 3-D shapes (cube, cone, cylinder, sphere)",
      "comparing length, weight and capacity directly (longer / shorter, heavier / lighter)",
    ],
    notYet: [
      "numbers greater than 20",
      "written addition or subtraction with totals above 10",
      "regrouping or borrowing",
      "multiplication or division",
      "fractions or decimals",
      "standard measurement units such as centimetres, inches or grams",
    ],
  },

  1: {
    range: "whole numbers 0-120; sums and differences within 20",
    covers: [
      "adding and subtracting within 20, building fluency within 10",
      "place value: tens and ones",
      "comparing two-digit numbers using < > =",
      "adding a one-digit number to a two-digit number within 100",
      "telling time to the hour and half hour",
      "halves and fourths by partitioning circles and rectangles",
      "naming and building 2-D and 3-D shapes",
    ],
    notYet: [
      "multiplication and division facts",
      "adding or subtracting fractions",
      "decimals",
      "numbers above 120",
      "two-digit plus two-digit addition that requires regrouping",
      "perimeter or area",
    ],
  },

  2: {
    range: "whole numbers 0-1000",
    covers: [
      "adding and subtracting within 100 fluently",
      "adding and subtracting three-digit numbers, including regrouping",
      "place value: hundreds, tens and ones",
      "skip counting by 5s, 10s and 100s",
      "even and odd numbers",
      "using arrays and repeated addition to build the idea behind multiplication",
      "counting coins and bills (US money) and making change",
      "telling time to the nearest five minutes",
      "measuring length in inches, feet, centimetres and metres",
      "reading simple bar graphs and line plots",
    ],
    notYet: [
      "multiplication and division as operations with memorised facts",
      "fractions beyond halves, thirds and fourths of a shape",
      "fraction arithmetic of any kind",
      "decimals",
      "rounding",
      "area and perimeter formulas",
    ],
  },

  3: {
    range: "whole numbers within 1000; multiplication facts 0-10",
    covers: [
      "multiplication and division facts within 100 (the 0-10 tables)",
      "multiplying a one-digit number by a multiple of 10",
      "adding and subtracting within 1000 with regrouping",
      "rounding whole numbers to the nearest 10 and 100",
      "unit fractions, and fractions as numbers on a number line",
      "equivalent fractions such as 1/2 = 2/4",
      "comparing two fractions that have the SAME numerator or the SAME denominator",
      "area by counting unit squares, and the perimeter of polygons",
      "telling time to the nearest minute, and elapsed time",
      "measuring mass (g, kg) and liquid volume (L, mL)",
    ],
    notYet: [
      "adding, subtracting or multiplying fractions",
      "simplifying fractions by finding a greatest common factor",
      "improper fractions and mixed-number arithmetic",
      "comparing fractions whose numerators AND denominators both differ",
      "decimals",
      "long division",
      "angles and degrees",
    ],
  },

  4: {
    range: "multi-digit whole numbers; decimals to hundredths",
    covers: [
      "multi-digit multiplication (up to 4 digits by 1 digit, and 2 digits by 2 digits)",
      "long division with remainders",
      "fraction equivalence, and comparing fractions with unlike denominators",
      "adding and subtracting fractions with like denominators",
      "multiplying a fraction by a whole number",
      "improper fractions and mixed numbers",
      "decimals to hundredths: comparing, adding and subtracting",
      "factors, multiples, prime and composite numbers",
      "angles, and measuring angles with a protractor",
      "area and perimeter of rectangles",
      "converting units within one measurement system",
    ],
    notYet: [
      "dividing by a fraction",
      "adding or subtracting fractions with unlike denominators",
      "multiplying two fractions together",
      "negative numbers",
      "ratios and proportions",
      "percentages",
      "volume of solid figures",
      "algebra with variables",
    ],
  },

  5: {
    range: "multi-digit whole numbers; decimals to thousandths; fractions",
    covers: [
      "adding and subtracting fractions with unlike denominators",
      "multiplying fractions, and dividing a unit fraction by a whole number",
      "mixed-number operations",
      "decimals to thousandths: all four operations",
      "multiplying and dividing multi-digit whole numbers",
      "order of operations including grouping symbols",
      "volume of rectangular prisms",
      "plotting and reading points on the coordinate plane (first quadrant)",
      "converting measurement units",
      "line plots using fractional data",
    ],
    notYet: [
      "negative numbers",
      "integer arithmetic",
      "ratios, rates and proportions",
      "percentages as a stand-alone topic",
      "expressions and equations with variables",
      "statistics such as mean, median or mode",
    ],
  },
};

// Normalises the grade value the UI sends ("K", "1".."5", or "k") and returns
// a prompt fragment. Returns "" for an unknown grade so callers can no-op.
function mathScope(grade) {
  const raw = String(grade == null ? "" : grade).trim().toUpperCase();
  const key = raw === "0" || raw === "K" ? "K" : raw;
  const s = MATH[key];
  if (!s) return "";

  return `

GRADE ${key} MATH SCOPE — HARD BOUNDARY
- Number range for this grade: ${s.range}
- This grade DOES cover: ${s.covers.join("; ")}.
- This grade does NOT cover these yet, so DO NOT include ANY question that needs them: ${s.notYet.join("; ")}.
- Every single question must be solvable using ONLY the skills listed above. If a question would need a skill from the "does not cover" list, throw it away and write a different one.
- Do not add filler questions about unrelated skills just to reach the required question count.`;
}

module.exports = { mathScope };
