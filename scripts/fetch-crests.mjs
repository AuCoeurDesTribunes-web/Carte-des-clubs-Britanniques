// Télécharge automatiquement les blasons des clubs listés dans index.html
// (CLUBS_DATA) vers le dossier crests/, avec vérification réelle du contenu
// téléchargé (pas juste "une URL a répondu", mais "c'est bien une image").
//
// Usage :
//   node fetch-crests.mjs
//
// Sorties :
//   - crests/<slug>.<ext>           un fichier par club trouvé
//   - crests-index.json             { slug: "filename.ext", ... } (lu par index.html)
//   - missing-crests.csv            les clubs pour lesquels rien n'a été trouvé
//
// Sources essayées dans l'ordre, par club :
//   1) TheSportsDB (base dédiée au football, badge officiel)
//   2) Wikipédia (image d'infobox, uniquement si le résumé de la page
//      confirme qu'il s'agit bien d'un club de football — évite les photos
//      de joueurs qui remontaient parfois en premier résultat)

import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = 'crests';
fs.mkdirSync(OUT_DIR, { recursive: true });

// ---- 1) Charger les clubs depuis index.html (source de vérité unique) ----
const html = fs.readFileSync('index.html', 'utf8');
const clubsMatch = html.match(/const CLUBS_DATA = (\{[\s\S]*?\});/);
if (!clubsMatch) throw new Error('CLUBS_DATA introuvable dans index.html');
const CLUBS_DATA = JSON.parse(clubsMatch[1]);

const leagueMetaMatch = html.match(/const LEAGUE_META = (\{[\s\S]*?\});/);
if (!leagueMetaMatch) throw new Error('LEAGUE_META introuvable dans index.html');
// hex/color contiennent des expressions CSS (var(--...)) donc on parse à la main
// juste le pays, qui est la seule info qui nous intéresse ici.
const COUNTRY_BY_LEAGUE = {};
for (const m of leagueMetaMatch[1].matchAll(/"([^"]+)":\s*\{[^}]*country:\s*"([^"]+)"/g)) {
  COUNTRY_BY_LEAGUE[m[1]] = m[2];
}

const COUNTRY_EN = {
  "Angleterre": "England",
  "Irlande": "Republic of Ireland",
  "Irlande du Nord": "Northern Ireland",
  "Écosse": "Scotland",
  "Pays de Galles": "Wales"
};

// ---- helpers (doivent matcher slugify() dans index.html) ----
function slugify(name) {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
function normalizeTeamName(name) {
  return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}
function nameVariants(name) {
  const variants = new Set([name]);
  const stripped = name.replace(/\s+\b(FC|AFC|CF)\b\.?$/i, '').trim();
  if (stripped && stripped !== name) variants.add(stripped);
  return [...variants];
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extFromContentType(ct) {
  if (!ct) return null;
  if (ct.includes('png')) return 'png';
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  if (ct.includes('webp')) return 'webp';
  return null; // svg volontairement exclu : pas trivial à valider/afficher de façon fiable ici
}

// Télécharge une URL et ne la garde que si c'est vraiment une image
// (content-type image/* et taille raisonnable — évite les pages d'erreur
// HTML de quelques centaines d'octets déguisées en "image introuvable").
async function downloadIfRealImage(url, destBase) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const ct = res.headers.get('content-type') || '';
  const ext = extFromContentType(ct);
  if (!ext) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 300) return null; // trop petit pour être un vrai blason
  const filename = `${destBase}.${ext}`;
  fs.writeFileSync(path.join(OUT_DIR, filename), buf);
  return filename;
}

// ---- 2) TheSportsDB ----
async function tryTheSportsDB(name, countryEn) {
  for (const variant of nameVariants(name)) {
    const url = `https://www.thesportsdb.com/api/v1/json/123/searchteams.php?t=${encodeURIComponent(variant)}`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      let teams = (data && data.teams) || [];
      teams = teams.filter(t => t.strSport === 'Soccer');
      if (!teams.length) continue;

      const norm = normalizeTeamName(name);
      const best =
        teams.find(t => normalizeTeamName(t.strTeam || '') === norm) ||
        (countryEn && teams.find(t => (t.strCountry || '').toLowerCase() === countryEn.toLowerCase())) ||
        teams[0];

      if (best && best.strTeamBadge) return best.strTeamBadge;
    } catch (e) { /* on tente la variante suivante */ }
    await sleep(300); // reste raisonnable sur la clé publique partagée "123"
  }
  return null;
}

// ---- 3) Wikipédia (repli), avec vérification que la page parle bien d'un club ----
async function tryWikipedia(name) {
  const query = `${name} football club`;
  const url = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=1&prop=pageimages|extracts&pithumbsize=200&exintro=1&explaintext=1&exsentences=2&format=json&origin=*`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const pages = data && data.query && data.query.pages;
    if (!pages) return null;
    const page = Object.values(pages)[0];
    const thumb = page && page.thumbnail && page.thumbnail.source;
    const intro = ((page && page.extract) || '').toLowerCase();
    const looksLikeClub = /football club|soccer club|association football/.test(intro);
    if (thumb && looksLikeClub) return thumb;
  } catch (e) { /* abandon pour ce club */ }
  return null;
}

// ---- 4) Boucle principale ----
const index = {};   // slug -> filename
const missing = []; // { league, club }
let done = 0;
let totalClubs = 0;
for (const clubs of Object.values(CLUBS_DATA)) totalClubs += clubs.length;

for (const [league, clubs] of Object.entries(CLUBS_DATA)) {
  const countryFr = COUNTRY_BY_LEAGUE[league];
  const countryEn = COUNTRY_EN[countryFr];

  for (const club of clubs) {
    done++;
    const slug = slugify(club.name);
    process.stdout.write(`[${done}/${totalClubs}] ${club.name}... `);

    let imgUrl = await tryTheSportsDB(club.name, countryEn);
    let source = 'TheSportsDB';
    if (!imgUrl) {
      imgUrl = await tryWikipedia(club.name);
      source = 'Wikipedia';
    }

    if (imgUrl) {
      const filename = await downloadIfRealImage(imgUrl, slug);
      if (filename) {
        index[slug] = filename;
        console.log(`OK (${source})`);
      } else {
        missing.push({ league, club: club.name });
        console.log(`échec téléchargement (${source} a renvoyé une URL mais pas une image valide)`);
      }
    } else {
      missing.push({ league, club: club.name });
      console.log('non trouvé');
    }

    await sleep(250); // pause polie entre clubs
  }
}

fs.writeFileSync('crests-index.json', JSON.stringify(index, null, 2));

const csvLines = ['league,club', ...missing.map(m => `"${m.league}","${m.club}"`)];
fs.writeFileSync('missing-crests.csv', csvLines.join('\n'));

console.log('\n---');
console.log(`Terminé : ${Object.keys(index).length}/${totalClubs} logos récupérés.`);
console.log(`${missing.length} club(s) sans logo → voir missing-crests.csv`);
