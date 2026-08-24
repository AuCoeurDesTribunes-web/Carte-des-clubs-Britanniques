// Nettoie tous les fichiers .svg de crests/ et competition-logos/ :
// - retire un éventuel BOM UTF-8 en tête de fichier (cause fréquente de
//   l'erreur "Start tag expected, '<' not found / Encoding error" que
//   certains moteurs de rendu stricts (Firefox, certains navigateurs
//   Android) affichent alors que Chrome desktop l'ignore silencieusement.
// - retire tout caractère blanc parasite avant le premier "<"
// - signale les fichiers qui restent invalides après nettoyage (vraiment
//   corrompus, pas juste un BOM)
//
// Usage :
//   node scripts/clean-svgs.mjs
//
// Le script MODIFIE les fichiers sur place (seulement s'il y avait
// vraiment un BOM/caractère parasite à retirer) et affiche un rapport.

import fs from 'node:fs';
import path from 'node:path';

const DIRS = ['crests', 'competition-logos'];
const BOM_UTF8 = Buffer.from([0xEF, 0xBB, 0xBF]);
const BOM_UTF16_LE = Buffer.from([0xFF, 0xFE]);
const BOM_UTF16_BE = Buffer.from([0xFE, 0xFF]);

// Convertit un buffer UTF-16 BE en UTF-16 LE (Node ne sait décoder que le LE
// nativement) en inversant chaque paire d'octets.
function swapUtf16Endianness(buf) {
  const swapped = Buffer.alloc(buf.length);
  for (let i = 0; i + 1 < buf.length; i += 2) {
    swapped[i] = buf[i + 1];
    swapped[i + 1] = buf[i];
  }
  return swapped;
}

// Heuristique pour repérer de l'UTF-16 SANS BOM : dans du XML/SVG (donc
// essentiellement des caractères ASCII), un octet sur deux est un octet nul.
function looksLikeUtf16WithoutBom(buf) {
  if (buf.length < 8) return null;
  const sampleLen = Math.min(64, buf.length - (buf.length % 2));
  let nullAtOdd = 0, nullAtEven = 0;
  for (let i = 0; i < sampleLen; i += 2) {
    if (buf[i] === 0x00) nullAtEven++;
    if (buf[i + 1] === 0x00) nullAtOdd++;
  }
  const half = sampleLen / 2;
  if (nullAtOdd > half * 0.8) return 'LE';  // <c>\0<v>\0... → nul sur les octets impairs
  if (nullAtEven > half * 0.8) return 'BE'; // \0<c>\0<v>... → nul sur les octets pairs
  return null;
}

let cleaned = 0;
let alreadyOk = 0;
let stillBroken = [];
let skipped = 0;

for (const dir of DIRS) {
  if (!fs.existsSync(dir)) { console.log(`(dossier ${dir}/ absent, ignoré)`); continue; }

  const files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.svg'));
  console.log(`\n--- ${dir}/ (${files.length} fichiers .svg) ---`);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const raw = fs.readFileSync(filePath);

    let content = raw;
    let wasModified = false;

    // 1) UTF-16 avec BOM (LE ou BE) → reconvertir en UTF-8
    if (content.length >= 2 && content.subarray(0, 2).equals(BOM_UTF16_LE)) {
      content = Buffer.from(content.subarray(2).toString('utf16le'), 'utf8');
      wasModified = true;
    } else if (content.length >= 2 && content.subarray(0, 2).equals(BOM_UTF16_BE)) {
      const swapped = swapUtf16Endianness(content.subarray(2));
      content = Buffer.from(swapped.toString('utf16le'), 'utf8');
      wasModified = true;
    } else {
      // 2) UTF-16 SANS BOM (heuristique sur le motif d'octets nuls)
      const guess = looksLikeUtf16WithoutBom(content);
      if (guess === 'LE') {
        content = Buffer.from(content.toString('utf16le'), 'utf8');
        wasModified = true;
      } else if (guess === 'BE') {
        content = Buffer.from(swapUtf16Endianness(content).toString('utf16le'), 'utf8');
        wasModified = true;
      }
    }

    // 3) Retirer un BOM UTF-8 en tête, s'il y en a un (après une éventuelle
    //    conversion UTF-16→UTF-8 ci-dessus, ou si le fichier était déjà en UTF-8)
    if (content.length >= 3 && content.subarray(0, 3).equals(BOM_UTF8)) {
      content = content.subarray(3);
      wasModified = true;
    }

    // 4) Retirer tout espace/retour à la ligne parasite avant le premier "<"
    const text = content.toString('utf8');
    const firstLt = text.indexOf('<');
    if (firstLt > 0 && text.slice(0, firstLt).trim() === '') {
      content = Buffer.from(text.slice(firstLt), 'utf8');
      wasModified = true;
    }

    if (wasModified) {
      fs.writeFileSync(filePath, content);
      cleaned++;
      console.log(`  🧹 nettoyé : ${file}`);
    } else {
      alreadyOk++;
    }

    // 3) Vérifier que le fichier commence bien par "<" après nettoyage,
    //    et qu'il contient bien une balise <svg — sinon il est vraiment
    //    corrompu (pas juste un problème de BOM) et doit être re-téléchargé.
    const finalText = content.toString('utf8').trimStart();
    if (!finalText.startsWith('<') || !/<[a-z0-9]*:?svg[\s>]/i.test(finalText)) {
      stillBroken.push(filePath);
    }
  }
}

console.log('\n=== Résumé ===');
console.log(`${cleaned} fichier(s) nettoyé(s) (BOM/caractère parasite retiré).`);
console.log(`${alreadyOk} fichier(s) déjà propres.`);

if (stillBroken.length) {
  console.log(`\n⚠️  ${stillBroken.length} fichier(s) toujours invalides après nettoyage (à re-télécharger, probablement corrompus au-delà d'un simple BOM) :`);
  stillBroken.forEach(f => console.log(`  - ${f}`));
} else {
  console.log('\nTous les fichiers SVG sont valides. 🎉');
}

// Résumé dans l'onglet Actions de GitHub, si dispo — sans faire échouer le
// job pour autant : on préfère committer les fichiers nettoyés et signaler
// les cas restants plutôt que de bloquer toute la suite du pipeline.
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    `### Nettoyage des SVG`,
    ``,
    `**${cleaned}** fichier(s) nettoyé(s), **${alreadyOk}** déjà propres.`,
    ``,
  ];
  if (stillBroken.length) {
    lines.push(`#### ⚠️ Fichiers toujours invalides (à re-télécharger)`, '');
    stillBroken.forEach(f => lines.push(`- \`${f}\``));
  }
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
}
