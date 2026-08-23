// Génère fixtures.json : tous les matchs à domicile à venir de chaque club.
//
// Source : football-data.org (plan gratuit, gratuit à vie, données de la
// saison en cours). Son plan gratuit ne couvre que 12 compétitions :
// Premier League, Championship, Ligue des Champions, Bundesliga, Eredivisie,
// Brasileirão, La Liga, Ligue 1, Primeira Liga, Championnat d'Europe,
// Serie A, Coupe du Monde. Ici, seules Premier League (PL), Championship
// (ELC) et Ligue des Champions (CL) nous concernent. L'Europa League et les
// coupes nationales (FA Cup, Carabao Cup...) ne sont PAS disponibles via
// cette API, à aucun tarif — pour les 7 autres compétitions de la carte
// (sans lien avec la CL), le popup retombe automatiquement sur le lien
// Flashscore (voir index.html) — c'est un choix assumé, pas un bug.

import fs from 'node:fs';

const TOKEN = process.env.FOOTBALL_DATA_TOKEN;
if (!TOKEN) {
  console.error('FOOTBALL_DATA_TOKEN manquant — vérifie le secret GitHub.');
  process.exit(1);
}

const BASE = 'https://api.football-data.org/v4';
const HEADERS = { 'X-Auth-Token': TOKEN };

async function apiGet(path) {
  const res = await fetch(BASE + path, { headers: HEADERS });
  if (!res.ok) {
    console.warn(`HTTP ${res.status} sur ${path}`);
    return null;
  }
  return res.json();
}

// 1) Charger les clubs directement depuis index.html : une seule source de vérité.
const html = fs.readFileSync('index.html', 'utf8');
const clubsMatch = html.match(/const CLUBS_DATA = (\{[\s\S]*?\});/);
if (!clubsMatch) throw new Error('CLUBS_DATA introuvable dans index.html');
const CLUBS_DATA = JSON.parse(clubsMatch[1]);

// Doit matcher le slugify() de index.html / fetch-crests.mjs : sert à
// nommer les fichiers logos de compétition (competition-logos/<slug>.<ext>).
function slugify(name) {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// 2) Championnats domestiques couverts gratuitement : on ne cherche leurs
//    clubs que dans LEUR propre liste (CLUBS_DATA[leagueKey]).
const DOMESTIC_COMPETITIONS = {
  'Premier League': { code: 'PL', label: 'Premier League' },
  'England - Championship': { code: 'ELC', label: 'Championship' }
};

// 3) Compétitions européennes/internationales couvertes gratuitement : leurs
//    clubs peuvent venir de N'IMPORTE QUELLE ligue de CLUBS_DATA, donc on les
//    cherche dans un index global de tous les clubs de la carte.
const EUROPEAN_COMPETITIONS = {
  CL: { code: 'CL', label: 'Ligue des Champions' }
  // Europa League (EL) et coupes nationales : non disponibles sur ce plan.
};

function normalize(name) {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/\b(fc|afc|cf|the)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

const today = new Date();

const fixturesByClub = {};
const unmatchedTeams = [];

function pushFixture(clubName, date, opponent, label, slug) {
  if (new Date(date) < today) return; // match déjà joué : on ne l'envoie pas
  const list = fixturesByClub[clubName] || (fixturesByClub[clubName] = []);
  list.push({
    date,
    opponent,
    competition: label,
    competitionSlug: slug
  });
}

function findMatch(clubIndex, homeName) {
  const homeNorm = normalize(homeName);
  return clubIndex.find(c =>
    c.norm === homeNorm || c.norm.includes(homeNorm) || homeNorm.includes(c.norm)
  );
}

// ---- Compétitions domestiques : un club = une ligue précise ----
for (const [leagueKey, { code, label }] of Object.entries(DOMESTIC_COMPETITIONS)) {
  const clubs = CLUBS_DATA[leagueKey] || [];
  const clubIndex = clubs.map(c => ({ club: c, norm: normalize(c.name) }));
  // Le slug est basé sur la clé de ligue complète (ex. "England -
  // Championship"), exactement comme dans la légende de index.html, afin
  // qu'un seul fichier logo serve à la fois à la légende et aux popups.
  const slug = slugify(leagueKey);

  const data = await apiGet(`/competitions/${code}/matches`);
  if (!data || !data.matches) {
    console.warn('Pas de données reçues pour', leagueKey);
    continue;
  }

  data.matches.forEach(m => {
    const homeName = m.homeTeam?.name || '';
    const match = findMatch(clubIndex, homeName);
    if (!match) {
      unmatchedTeams.push({ league: leagueKey, apiName: homeName });
      return;
    }
    pushFixture(match.club.name, m.utcDate, m.awayTeam?.name || '?', label, slug);
  });

  await new Promise(r => setTimeout(r, 3000));
}

// ---- Compétitions européennes : recherche dans TOUS les clubs de la carte ----
const ALL_CLUBS_INDEX = [];
Object.values(CLUBS_DATA).forEach(clubs => {
  clubs.forEach(c => ALL_CLUBS_INDEX.push({ club: c, norm: normalize(c.name) }));
});

for (const { code, label } of Object.values(EUROPEAN_COMPETITIONS)) {
  const data = await apiGet(`/competitions/${code}/matches`);
  if (!data || !data.matches) {
    console.warn('Pas de données reçues pour', label);
    continue;
  }

  data.matches.forEach(m => {
    const homeName = m.homeTeam?.name || '';
    const match = findMatch(ALL_CLUBS_INDEX, homeName);
    if (!match) return; // équipe étrangère hors carte : normal, on ignore
    pushFixture(match.club.name, m.utcDate, m.awayTeam?.name || '?', label, slugify(label));
  });

  await new Promise(r => setTimeout(r, 3000));
}

// Trier chronologiquement chaque club (tous les matchs à venir, toutes
// compétitions confondues, mélangés puis triés par date).
Object.keys(fixturesByClub).forEach(name => {
  fixturesByClub[name].sort((a, b) => new Date(a.date) - new Date(b.date));
});

fs.writeFileSync('fixtures.json', JSON.stringify({
  generated_at: new Date().toISOString(),
  clubs: fixturesByClub
}, null, 2));

if (unmatchedTeams.length) {
  console.warn(`${unmatchedTeams.length} équipe(s) renvoyée(s) par l'API non reconnues sur la carte :`);
  console.warn(JSON.stringify(unmatchedTeams, null, 2));
}

console.log(`Terminé : calendrier généré pour ${Object.keys(fixturesByClub).length} club(s) (Premier League + Championship + Ligue des Champions).`);
