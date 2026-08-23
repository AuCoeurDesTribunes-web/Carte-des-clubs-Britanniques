// Génère fixtures.json : les prochains matchs à domicile de chaque club.
//
// Source : football-data.org (plan gratuit, gratuit à vie, données de la
// saison en cours). Son plan gratuit ne couvre que 12 grands championnats,
// donc ici seulement Premier League (PL) et Championship (ELC) auront un
// vrai calendrier. Pour les 8 autres compétitions de la carte, le popup
// retombe automatiquement sur le lien Flashscore (voir index.html) —
// c'est un choix assumé, pas un bug.

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

// 2) Championnats couverts gratuitement par football-data.org, avec leur code
const LEAGUE_CODES = {
  'Premier League': { code: 'PL', label: 'Premier League' },
  'England - Championship': { code: 'ELC', label: 'Championship' }
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
const from = today.toISOString().slice(0, 10);
const toDate = new Date(today.getTime() + 45 * 24 * 3600 * 1000);
const to = toDate.toISOString().slice(0, 10);

const fixturesByClub = {};
const unmatchedTeams = [];

for (const [leagueKey, { code, label }] of Object.entries(LEAGUE_CODES)) {
  const clubs = CLUBS_DATA[leagueKey] || [];
  const clubIndex = clubs.map(c => ({ club: c, norm: normalize(c.name) }));

  const data = await apiGet(`/competitions/${code}/matches?dateFrom=${from}&dateTo=${to}`);
  if (!data || !data.matches) {
    console.warn('Pas de données reçues pour', leagueKey);
    continue;
  }

  data.matches.forEach(m => {
    const homeName = m.homeTeam?.name || '';
    const homeNorm = normalize(homeName);
    const match = clubIndex.find(c =>
      c.norm === homeNorm || c.norm.includes(homeNorm) || homeNorm.includes(c.norm)
    );
    if (!match) {
      unmatchedTeams.push({ league: leagueKey, apiName: homeName });
      return;
    }
    const list = fixturesByClub[match.club.name] || (fixturesByClub[match.club.name] = []);
    list.push({
      date: m.utcDate,
      opponent: m.awayTeam?.name || '?',
      competition: label
    });
  });

  // Le plan gratuit limite à 10 requêtes/minute — on souffle un peu entre
  // deux championnats, même si on est très loin de la limite ici.
  await new Promise(r => setTimeout(r, 3000));
}

// Trier chronologiquement et ne garder que les 5 prochains matchs par club
Object.keys(fixturesByClub).forEach(name => {
  fixturesByClub[name].sort((a, b) => new Date(a.date) - new Date(b.date));
  fixturesByClub[name] = fixturesByClub[name].slice(0, 5);
});

fs.writeFileSync('fixtures.json', JSON.stringify({
  generated_at: new Date().toISOString(),
  clubs: fixturesByClub
}, null, 2));

if (unmatchedTeams.length) {
  console.warn(`${unmatchedTeams.length} équipe(s) renvoyée(s) par l'API non reconnues sur la carte :`);
  console.warn(JSON.stringify(unmatchedTeams, null, 2));
}

console.log(`Terminé : calendrier généré pour ${Object.keys(fixturesByClub).length} club(s) (Premier League + Championship uniquement).`);
