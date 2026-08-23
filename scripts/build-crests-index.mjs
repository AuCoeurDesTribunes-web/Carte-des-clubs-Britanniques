// Construit crests-index.json à partir des fichiers déjà présents dans
// crests/ (déposés à la main, un logo par club). Aucun appel réseau.
//
// Usage :
//   node scripts/build-crests-index.mjs
//
// Sorties :
//   - crests-index.json     { slug: "filename.ext", ... }
//   - missing-crests.csv    clubs pour lesquels aucun fichier ne correspond
//
// Le script affiche aussi un résumé détaillé dans les logs (et dans le
// step summary GitHub Actions) pour voir immédiatement quel fichier était
// attendu pour chaque club manquant.

import fs from 'node:fs';
import path from 'node:path';

const CRESTS_DIR = 'crests';
const EXT_PRIORITY = ['svg', 'png', 'jpg', 'jpeg', 'webp'];

// ---- 1) Charger les clubs depuis index.html (source de vérité unique) ----
const html = fs.readFileSync('index.html', 'utf8');
const clubsMatch = html.match(/const CLUBS_DATA = (\{[\s\S]*?\});/);
if (!clubsMatch) throw new Error('CLUBS_DATA introuvable dans index.html');
const CLUBS_DATA = JSON.parse(clubsMatch[1]);

// Doit matcher exactement slugify() dans index.html.
function slugify(name) {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---- 2) Lister les fichiers réellement présents dans crests/ ----
if (!fs.existsSync(CRESTS_DIR)) {
  throw new Error(`Dossier ${CRESTS_DIR}/ introuvable`);
}
const filesOnDisk = fs.readdirSync(CRESTS_DIR).filter(f => {
  const ext = path.extname(f).slice(1).toLowerCase();
  return EXT_PRIORITY.includes(ext);
});

// Index exact (respecte la casse) ET index insensible à la casse, pour
// détecter les fichiers presque bons (ex: "Arsenal-FC.svg" au lieu de
// "arsenal-fc.svg") plutôt que de les rater silencieusement.
const exactSet = new Set(filesOnDisk);
const lowerMap = new Map(); // basename lowercase (sans ext) -> filename réel
for (const f of filesOnDisk) {
  const ext = path.extname(f);
  const base = path.basename(f, ext).toLowerCase();
  if (!lowerMap.has(base)) lowerMap.set(base, f);
}

// ---- 3) Associer chaque club à son fichier ----
const index = {};
const missing = [];       // { league, club, expected } — vraiment introuvable
const caseMismatch = [];  // { league, club, expected, found } — trouvé mais casse différente
let totalClubs = 0;
let matched = 0;

for (const [league, clubs] of Object.entries(CLUBS_DATA)) {
  for (const club of clubs) {
    totalClubs++;
    const slug = slugify(club.name);

    // 1) match exact (casse respectée) dans l'ordre de préférence d'extension
    let filename = null;
    for (const ext of EXT_PRIORITY) {
      const candidate = `${slug}.${ext}`;
      if (exactSet.has(candidate)) { filename = candidate; break; }
    }

    // 2) sinon, match insensible à la casse (le fichier existe mais mal nommé)
    if (!filename && lowerMap.has(slug)) {
      filename = lowerMap.get(slug);
      caseMismatch.push({ league, club: club.name, expected: `${slug}.<ext>`, found: filename });
    }

    if (filename) {
      index[slug] = filename;
      matched++;
    } else {
      missing.push({ league, club: club.name, expected: `${slug}.<svg|png|jpg|jpeg|webp>` });
    }
  }
}

fs.writeFileSync('crests-index.json', JSON.stringify(index, null, 2));

const csvLines = ['league,club,expected_filename', ...missing.map(m => `"${m.league}","${m.club}","${m.expected}"`)];
fs.writeFileSync('missing-crests.csv', csvLines.join('\n'));

// ---- 4) Rapport détaillé ----
console.log(`Terminé : ${matched}/${totalClubs} logos associés depuis ${CRESTS_DIR}/.`);

if (caseMismatch.length) {
  console.log(`\n⚠️  ${caseMismatch.length} fichier(s) trouvé(s) mais avec un nom légèrement différent de celui attendu :`);
  caseMismatch.forEach(m => console.log(`  - [${m.league}] ${m.club} : attendu "${m.expected}", trouvé "${m.found}" → utilisé quand même`));
}

if (missing.length) {
  console.log(`\n❌ ${missing.length} club(s) sans fichier correspondant du tout :`);
  missing.forEach(m => console.log(`  - [${m.league}] ${m.club} → attendu : crests/${m.expected}`));
} else {
  console.log('\nTous les clubs ont un logo. 🎉');
}

// Résumé dans l'onglet Actions de GitHub, si dispo
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    `### Logos des clubs`,
    ``,
    `**${matched}/${totalClubs}** clubs associés à un logo.`,
    ``,
  ];
  if (caseMismatch.length) {
    lines.push(`#### ⚠️ Noms de fichiers légèrement différents (acceptés quand même)`, '');
    caseMismatch.forEach(m => lines.push(`- [${m.league}] **${m.club}** — attendu \`${m.expected}\`, trouvé \`${m.found}\``));
    lines.push('');
  }
  if (missing.length) {
    lines.push(`#### ❌ Clubs sans logo`, '');
    missing.forEach(m => lines.push(`- [${m.league}] **${m.club}** — attendu : \`crests/${m.expected}\``));
  }
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
}
