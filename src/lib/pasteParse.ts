// Turns pasted plain text (one person per line) into rows for the sign-up list.
// Everything after the name is optional and can come in any order:
//   Brother Mulenga Chanda, Woodlands, Tenor I, 0971 234 567
import type { Lookup, PasteRowIn } from './types';

export interface PasteDefaults { title_id: string | null; area_id: string | null; voice_part_id: string | null; district: string }
export interface ParsedLine { line: number; raw: string; row: PasteRowIn; notes: string[] }

const voiceKey = (s: string) => {
  let k = s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const short = /^([satb])(1|2|i|ii)$/.exec(k);
  if (short) k = { s: 'soprano', a: 'alto', t: 'tenor', b: 'bass' }[short[1]!]! + short[2];
  return k.replace(/(soprano|alto|tenor|bass)(ii|2)$/, '$12').replace(/(soprano|alto|tenor|bass)(i|1)$/, '$11');
};

export function parsePaste(
  text: string,
  lk: { titles: Lookup[]; areas: Lookup[]; voices: Lookup[] },
  d: PasteDefaults,
): ParsedLine[] {
  // title words we recognise at the start of a name
  const aliases: [string, Lookup][] = [];
  for (const t of lk.titles.filter((x) => x.active)) {
    const n = t.name.toLowerCase();
    aliases.push([n, t]);
    if (n === 'brother') aliases.push(['bro', t], ['br', t]);
    if (n === 'sister') aliases.push(['sis', t]);
  }
  aliases.sort((a, b) => b[0].length - a[0].length);
  const voiceByKey = new Map(lk.voices.filter((v) => v.active).map((v) => [voiceKey(v.name), v]));
  const areaByName = new Map(lk.areas.filter((a) => a.active).map((a) => [a.name.toLowerCase(), a]));

  const out: ParsedLine[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    let line = raw.trim().replace(/^(?:\d+\s*[.)\-:]|[-*•])\s+/, '').trim();
    if (!line) return;
    const parts = line.split(/\t|,|;|\|/).map((p) => p.trim()).filter(Boolean);
    let name = parts.shift() ?? '';
    const notes: string[] = [];
    let title_id = d.title_id, spec = '';

    for (const [alias, t] of aliases) {
      const m = new RegExp(`^${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.?(?:\\s*\\(([^)]*)\\))?\\s+(?=\\S)`, 'i').exec(name);
      if (m) { title_id = t.id; spec = (m[1] ?? '').trim(); name = name.slice(m[0].length).trim(); break; }
    }

    let area_id = d.area_id, voice_part_id = d.voice_part_id, district = d.district, contact = '';
    let districtSet = false;
    for (const p of parts) {
      const digits = p.replace(/\D/g, '');
      const v = voiceByKey.get(voiceKey(p));
      const a = areaByName.get(p.toLowerCase());
      if (digits.length >= 9 && digits.length <= 13 && /^[+\d\s()-]+$/.test(p)) contact = p;
      else if (v) voice_part_id = v.id;
      else if (a) area_id = a.id;
      else if (!districtSet) { district = p; districtSet = true; }
      else notes.push(`Did not understand “${p}”`);
    }
    out.push({
      line: i + 1, raw,
      row: { title_id, title_specify: spec, name, area_id, district, voice_part_id, contact, force: false },
      notes,
    });
  });
  return out;
}
