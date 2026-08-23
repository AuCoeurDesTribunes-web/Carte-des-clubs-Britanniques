// Construit crests-index.json à partir des fichiers déjà présents dans
// crests/ (déposés à la main). Aucun appel réseau : on associe simplement
// chaque club de CLUBS_DATA (index.html) à son fichier crests/<slug>.<ext>
// s'il existe.
//
// Usage :
//   node build-crests-index.mjs
//
// Sorties :
//   - crests-index.json     { slug: "filename.ext", ... }
//   - missing-crests.csv    clubs pour lesquels aucun fichier ne correspond

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
const filesOnDisk = new Set(fs.readdirSync(CRESTS_DIR));

// ---- 3) Associer chaque club à son fichier ----
const index = {};
const missing = []; // { league, club }
let totalClubs = 0;
let matched = 0;

for (const [league, clubs] of Object.entries(CLUBS_DATA)) {
  for (const club of clubs) {
    totalClubs++;
    const slug = slugify(club.name);

    let filename = null;
    for (const ext of EXT_PRIORITY) {
      const candidate = `${slug}.${ext}`;
      if (filesOnDisk.has(candidate)) {
        filename = candidate;
        break;
      }
    }

    if (filename) {
      index[slug] = filename;
      matched++;
    } else {
      missing.push({ league, club: club.name });
    }
  }
}

fs.writeFileSync('crests-index.json', JSON.stringify(index, null, 2));

const csvLines = ['league,club', ...missing.map(m => `"${m.league}","${m.club}"`)];
fs.writeFileSync('missing-crests.csv', csvLines.join('\n'));

console.log(`Terminé : ${matched}/${totalClubs} logos associés depuis ${CRESTS_DIR}/.`);
if (missing.length) {
  console.log(`${missing.length} club(s) sans fichier correspondant → voir missing-crests.csv :`);
  missing.forEach(m => console.log(`  - [${m.league}] ${m.club} (attendu: crests/${slugify(m.club)}.<ext>)`));
} else {
  console.log('Tous les clubs ont un logo. 🎉');
}
