// Reconstruit competition-logos-index.json à partir du contenu RÉEL du
// dossier competition-logos/ (au lieu de laisser un fichier édité à la main
// devenir périmé dès que clean-svgs.mjs renomme un logo).
//
// Clé   : nom de fichier sans extension, en minuscules (le "slug"). Les
//         fichiers du dossier doivent déjà être nommés en slug
//         (ex: "premier-league.svg") — c'est le cas actuellement.
// Valeur: nom de fichier réel, extension incluse — celle qui existe
//         vraiment sur disque, y compris après un renommage par
//         clean-svgs.mjs (ex: "premier-league.webp" si le fichier a été
//         re-détecté comme un WebP malgré son extension .svg d'origine).
//
// Usage :
//   node scripts/build-competition-logos-index.mjs

import fs from 'node:fs';
import path from 'node:path';

const DIR = 'competition-logos';
const OUT = 'competition-logos-index.json';
const IMAGE_EXTENSIONS = ['.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif'];

if (!fs.existsSync(DIR)) {
  console.log(`(dossier ${DIR}/ absent, rien à faire)`);
  process.exit(0);
}

const files = fs.readdirSync(DIR)
  .filter(f => IMAGE_EXTENSIONS.includes(path.extname(f).toLowerCase()));

const index = {};
const collisions = [];

for (const file of files) {
  const slug = path.basename(file, path.extname(file)).toLowerCase();
  if (index[slug] && index[slug] !== file) {
    collisions.push({ slug, kept: index[slug], ignored: file });
    continue; // on garde la première trouvée, on signale le doublon
  }
  index[slug] = file;
}

const sorted = Object.fromEntries(
  Object.entries(index).sort(([a], [b]) => a.localeCompare(b))
);

fs.writeFileSync(OUT, JSON.stringify(sorted, null, 2) + '\n');

console.log(`✅ ${OUT} régénéré avec ${Object.keys(sorted).length} logo(s) depuis ${DIR}/.`);
if (collisions.length) {
  console.log(`⚠️  ${collisions.length} collision(s) de slug (deux fichiers → même clé) :`);
  collisions.forEach(c => console.log(`  - "${c.slug}" : ${c.kept} conservé, ${c.ignored} ignoré`));
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    `### Index des logos de compétition`,
    ``,
    `**${Object.keys(sorted).length}** logo(s) indexé(s) depuis \`${DIR}/\`.`,
    ``,
  ];
  if (collisions.length) {
    lines.push(`#### ⚠️ Collisions de slug`, '');
    collisions.forEach(c => lines.push(`- \`${c.slug}\` : \`${c.kept}\` conservé, \`${c.ignored}\` ignoré`));
    lines.push('');
  }
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
}
