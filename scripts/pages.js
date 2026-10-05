// scripts/pages.js
// The programmatic-SEO page list, shared by gen-seo.js (builds the pages) and
// gen-samples.js (builds the real sample worksheet embedded in each page).
// Kept in one place so the two scripts can never drift apart.

const gradeByNum = {
  K: ["Kindergarten", "kindergarten"],
  "1": ["1st Grade", "1st-grade"],
  "2": ["2nd Grade", "2nd-grade"],
  "3": ["3rd Grade", "3rd-grade"],
  "4": ["4th Grade", "4th-grade"],
  "5": ["5th Grade", "5th-grade"],
};

const subjects = [
  ["Math", "math", "math"],
  ["Reading", "reading", "reading comprehension"],
  ["Spelling", "spelling", "spelling"],
  ["Vocabulary", "vocabulary", "vocabulary"],
  ["Grammar", "grammar", "grammar"],
  ["Writing", "writing", "writing"],
  ["Science", "science", "science"],
];

// [gradeNum, subject, topicLabel, generatorTopic]
const topics = [
  ["K", "Math", "Counting", "Kindergarten counting to 20"],
  ["K", "Reading", "Sight Words", "Kindergarten sight words"],
  ["K", "Spelling", "Letter Sounds", "Kindergarten beginning letter sounds"],
  ["1", "Math", "Addition", "1st Grade addition to 20"],
  ["1", "Math", "Subtraction", "1st Grade subtraction within 20"],
  ["1", "Reading", "Sight Words", "1st Grade sight words"],
  ["1", "Spelling", "Phonics", "1st Grade phonics"],
  ["2", "Math", "Fractions", "2nd Grade fractions"],
  ["2", "Math", "Addition With Regrouping", "2nd Grade addition with regrouping"],
  ["2", "Math", "Place Value", "2nd Grade place value"],
  ["2", "Reading", "Reading Comprehension", "2nd Grade reading comprehension"],
  ["3", "Math", "Multiplication", "3rd Grade multiplication"],
  ["3", "Math", "Division", "3rd Grade division"],
  ["3", "Math", "Fractions", "3rd Grade fractions"],
  ["4", "Math", "Long Division", "4th Grade long division"],
  ["4", "Math", "Fractions", "4th Grade fractions"],
  ["5", "Math", "Decimals", "5th Grade decimals"],
  ["5", "Math", "Fractions", "5th Grade fractions"],
  ["5", "Spelling", "Vocabulary", "5th Grade vocabulary"],
];

const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const pages = [];
const seen = new Set();
function addPage(p) {
  if (seen.has(p.slug)) return;
  seen.add(p.slug);
  pages.push(p);
}

for (const [num, [gl, gs]] of Object.entries(gradeByNum)) {
  for (const [subj, sslug, stopic] of subjects) {
    addPage({
      slug: `${gs}-${sslug}-worksheets`,
      grade: num,
      gradeLabel: gl,
      subject: subj,
      genTopic: `${gl} ${stopic}`,
      h1: `Free ${gl} ${subj} Worksheets`,
    });
  }
}
for (const [num, subj, topicLabel, genTopic] of topics) {
  const gl = gradeByNum[num][0];
  const gs = gradeByNum[num][1];
  addPage({
    slug: `${gs}-${slugify(topicLabel)}-worksheets`,
    grade: num,
    gradeLabel: gl,
    subject: subj,
    genTopic,
    h1: `Free ${gl} ${topicLabel} Worksheets`,
  });
}

module.exports = { gradeByNum, subjects, topics, slugify, pages };
