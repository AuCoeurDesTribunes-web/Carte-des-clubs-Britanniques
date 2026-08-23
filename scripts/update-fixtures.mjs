// Génère fixtures.json : les prochains matchs à domicile de chaque club.
// Stratégie économe en requêtes : on interroge le calendrier de chaque
// championnat (10 requêtes) plutôt que chaque club individuellement
// (176 requêtes), ce qui reste largement dans le quota gratuit de
// l'API-Football (100 requêtes/jour), même en tournant 2x/jour.

import fs from 'node:fs';

const API_KEY = process.env.API_FOOTBALL_KEY;
if (!API_KEY) {
  console.error('API_FOOTBALL_KEY manquante — vérifie le secret GitHub.');
  process.exit(1);
}

const BASE = 'https://v3.football.api-sports.io';
const HEADERS = { 'x-apisports-key': API_KEY };

async function apiGet(path) {
  const res = await fetch(BASE + path, { headers: HEADERS });
  if (!res.ok) {
    console.warn(`HTTP ${res.status} sur ${path}`);
    return [];
  }
  const data = await res.json();
  if (data.errors && Object.keys(data.errors).length) {
    console.warn('Avertissement API pour', path, JSON.stringify(data.errors));
  }
  return data.response || [];
}

// 1) Charger les clubs directement depuis index.html : une seule source de vérité,
//    pas de duplication des noms/coordonnées à maintenir à deux endroits.
const html = fs.readFileSync('index.html', 'utf8');
const clubsMatch = html.match(/const CLUBS_DATA = (\{[\s\S]*?\});/);
if (!clubsMatch) throw new Error('CLUBS_DATA introuvable dans index.html');
const CLUBS_DATA = JSON.parse(clubsMatch[1]);

// 2) Correspondance entre chaque championnat de la carte et son nom/pays
//    tels qu'attendus par l'API-Football.
const LEAGUE_SEARCH = {
  'Premier League': { name: 'Premier League', country: 'England' },
  'England - Championship': { name: 'Championship', country: 'England' },
  'England - League One': { name: 'League One', country: 'England' },
  'England - League Two': { name: 'League Two', country: 'England' },
  'England - National League': { name: 'National League', country: 'England' },
  'Ireland - Premier division': { name: 'Premier Division', country: 'Ireland' },
  'Northern Ireland - Premiership': { name: 'Premiership', country: 'Northern Ireland' },
  'Scotland - Premiership': { name: 'Premiership', country: 'Scotland' },
  'Scotland - Championship': { name: 'Championship', country: 'Scotland' },
  'Wales - Cymru Premier': { name: 'Cymru Premier', country: 'Wales' }
};

// 3) Cache des identifiants de championnat (évite de les re-chercher à chaque run)
let leaguesCache = {};
try { leaguesCache = JSON.parse(fs.readFileSync('leagues.json', 'utf8')); } catch { /* premier run */ }

function normalize(name) {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(fc|afc|cf|the)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

async function resolveLeagueId(key, { name, country }) {
  if (leaguesCache[key]?.id) return leaguesCache[key].id;
  const results = await apiGet(`/leagues?name=${encodeURIComponent(name)}&country=${encodeURIComponent(country)}`);
  if (!results.length) {
    console.warn(`Championnat introuvable via l'API : ${name} (${country})`);
    return null;
  }
  const id = results[0].league.id;
  leaguesCache[key] = { id, name: results[0].league.name };
  return id;
}

async function getCurrentSeason(leagueId) {
  const results = await apiGet(`/leagues?id=${leagueId}`);
  if (!results.length) return null;
  const seasons = results[0].seasons || [];
  const current = seasons.find(s => s.current) || seasons[seasons.length - 1];
  return current ? current.year : null;
}

const today = new Date();
const from = today.toISOString().slice(0, 10);
const toDate = new Date(today.getTime() + 45 * 24 * 3600 * 1000);
const to = toDate.toISOString().slice(0, 10);

const fixturesByClub = {};
const unmatchedTeams = [];

for (const [leagueKey, clubs] of Object.entries(CLUBS_DATA)) {
  const search = LEAGUE_SEARCH[leagueKey];
  if (!search) { console.warn('Pas de correspondance API pour', leagueKey); continue; }

  const leagueId = await resolveLeagueId(leagueKey, search);
  if (!leagueId) continue;

  const season = await getCurrentSeason(leagueId);
  if (!season) { console.warn('Saison introuvable pour', leagueKey); continue; }

  const fixtures = await apiGet(`/fixtures?league=${leagueId}&season=${season}&from=${from}&to=${to}`);

  const clubIndex = clubs.map(c => ({ club: c, norm: normalize(c.name) }));

  fixtures.forEach(f => {
    const homeName = f.teams.home.name;
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
      date: f.fixture.date,
      opponent: f.teams.away.name,
      competition: search.name
    });
  });
}

// Trier chronologiquement et ne garder que les 5 prochains matchs par club
Object.keys(fixturesByClub).forEach(name => {
  fixturesByClub[name].sort((a, b) => new Date(a.date) - new Date(b.date));
  fixturesByClub[name] = fixturesByClub[name].slice(0, 5);
});

fs.writeFileSync('leagues.json', JSON.stringify(leaguesCache, null, 2));
fs.writeFileSync('fixtures.json', JSON.stringify({
  generated_at: new Date().toISOString(),
  clubs: fixturesByClub
}, null, 2));

if (unmatchedTeams.length) {
  console.warn(`${unmatchedTeams.length} équipe(s) renvoyée(s) par l'API non reconnues sur la carte :`);
  console.warn(JSON.stringify(unmatchedTeams, null, 2));
}

console.log(`Terminé : calendrier généré pour ${Object.keys(fixturesByClub).length} club(s) sur ${Object.keys(CLUBS_DATA).flatMap(k => CLUBS_DATA[k]).length}.`);
