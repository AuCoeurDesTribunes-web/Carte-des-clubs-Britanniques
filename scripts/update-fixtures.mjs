// Génère fixtures.json : tous les matchs à domicile à venir de chaque club.
//
// Source : football-data.org (plan gratuit, gratuit à vie, données de la
// saison en cours). Son plan gratuit ne couvre que 12 compétitions :
// Premier League, Championship, Ligue des Champions, Bundesliga, Eredivisie,
// Brasileirão, La Liga, Ligue 1, Primeira Liga, Championnat d'Europe,
// Serie A, Coupe du Monde. Ici, seules Premier League (PL), Championship
// (ELC), Bundesliga (BL1), Serie A (SA) et Ligue des Champions (CL) nous concernent. L'Europa League et les
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
  'England - Championship': { code: 'ELC', label: 'Championship' },
  'Germany - Bundesliga': { code: 'BL1', label: 'Bundesliga' },
  'Italy - Serie A': { code: 'SA', label: 'Serie A' }
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
    .replace(/\b(fc|afc|cf|cfc|the)\b/g, '')
    // Beaucoup de clubs allemands ont un nom officiel avec un numéro (année
    // de fondation) que l'API renvoie mais que la carte n'affiche pas
    // ("Bayer 04 Leverkusen" vs "Bayer Leverkusen", "TSG 1899 Hoffenheim" vs
    // "TSG Hoffenheim", "SV 07 Elversberg" vs "SV Elversberg") : on retire
    // les chiffres avant de comparer, sinon ces clubs ne matchent jamais.
    .replace(/[0-9]/g, '')
    .replace(/[^a-z]/g, '');
}

// Certains clubs ont un nom officiel (renvoyé par l'API) trop différent du
// nom affiché sur la carte pour qu'une comparaison de sous-chaînes suffise
// ("Inter Milan" vs "FC Internazionale Milano" : aucun des deux mots n'est
// inclus dans l'autre). On ajoute ici des noms alternatifs, indexés en plus
// du nom réel, uniquement pour la reconnaissance côté API — le nom affiché
// sur la carte (club.name) ne change jamais.
const ALIAS_NAMES = {
  'Inter Milan': ['Internazionale', 'Inter'],
};

function buildClubIndex(clubs) {
  const index = [];
  clubs.forEach(c => {
    index.push({ club: c, norm: normalize(c.name) });
    (ALIAS_NAMES[c.name] || []).forEach(alias => {
      index.push({ club: c, norm: normalize(alias) });
    });
  });
  return index;
}

// Index de TOUS les clubs de la carte (utilisé pour reconnaître les
// adversaires, pas seulement les clubs à domicile des compétitions
// européennes) : construit une seule fois, avant les boucles.
const ALL_CLUBS_INDEX = [];
Object.values(CLUBS_DATA).forEach(clubs => {
  buildClubIndex(clubs).forEach(entry => ALL_CLUBS_INDEX.push(entry));
});

const today = new Date();

const fixturesByClub = {};
const unmatchedTeams = [];

function pushFixture(clubName, date, opponent, label, slug) {
  if (new Date(date) < today) return; // match déjà joué : on ne l'envoie pas
  // On essaie de faire correspondre l'adversaire à un club de la carte
  // (CLUBS_DATA) : l'API renvoie parfois un nom légèrement différent
  // ("Manchester United FC" au lieu de "Manchester United", "Hull City AFC"
  // au lieu de "Hull City", "Brighton & Hove Albion FC" avec une esperluette
  // au lieu de "and"...). Sans ça, crestPath(opponent) dans index.html
  // génère un slug qui ne matche jamais crests-index.json, et le logo de
  // l'adversaire ne s'affiche jamais pour ces clubs-là. On utilise donc le
  // nom canonique de la carte quand on le reconnaît, et on ne garde le nom
  // brut de l'API que pour les clubs hors de la carte (adversaires
  // européens étrangers, par exemple).
  const opponentMatch = findMatch(ALL_CLUBS_INDEX, opponent);
  const resolvedOpponent = opponentMatch ? opponentMatch.club.name : opponent;

  const list = fixturesByClub[clubName] || (fixturesByClub[clubName] = []);
  list.push({
    date,
    opponent: resolvedOpponent,
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
  const clubIndex = buildClubIndex(clubs);
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

console.log(`Terminé : calendrier généré pour ${Object.keys(fixturesByClub).length} club(s) (Premier League + Championship + Bundesliga + Serie A + Ligue des Champions).`);
