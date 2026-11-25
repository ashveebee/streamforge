import { householdDevices, predict, type DeviceProfile, type FileFeatures, type Prediction, type Verdict } from './profile.js';

/*
 * Device playability: answers built from device profiles and library files.
 * Pure, so the demo can use it too.
 */

export interface LibraryFile {
  id: string;
  /** The movie, or the series an episode belongs to: what a title page shows. */
  titleId: string;
  title: string;
  kind: 'movie' | 'series';
  year?: number;
  versions: { name?: string; features: FileFeatures }[];
}

const SEVERITY: Record<Verdict, number> = { direct: 0, remux: 1, audio: 2, video: 3 };

/** The cheapest way a file with several versions could play. */
function bestOf(profile: DeviceProfile, f: LibraryFile) {
  return f.versions
    .map((v) => ({ name: v.name, p: predict(profile, v.features) }))
    .sort((a, b) => SEVERITY[a.p.verdict] - SEVERITY[b.p.verdict] || a.p.untested.length - b.p.untested.length)[0]!;
}

const summary = (p: DeviceProfile) => ({ key: p.key, device: p.device, client: p.client, plays: p.plays, lastSeen: p.lastSeen });

export function statusOf(all: DeviceProfile[], ready: boolean) {
  const household = new Set(householdDevices(all).map((p) => p.key));
  return { ready, devices: all.map((p) => ({ ...p, household: household.has(p.key) })) };
}

/** How the whole library plays on one device. */
export function libraryReport(profile: DeviceProfile, files: LibraryFile[], scannedAt: number) {
  const counts: Record<Verdict, number> = { direct: 0, remux: 0, audio: 0, video: 0 };
  const causes = new Map<string, { text: string; verdict: Verdict; files: number }>();
  const untested = new Map<string, { text: string; files: number }>();
  const titles = new Map<string, { id: string; title: string; kind: 'movie' | 'series'; year?: number; files: number; counts: Record<Verdict, number>; problems: Set<string>; worst: Verdict }>();
  for (const f of files) {
    const { p } = bestOf(profile, f);
    counts[p.verdict]++;
    for (const x of p.problems) {
      const c = causes.get(x.text) ?? { text: x.text, verdict: p.verdict, files: 0 };
      c.files++;
      if (SEVERITY[p.verdict] > SEVERITY[c.verdict]) c.verdict = p.verdict;
      causes.set(x.text, c);
    }
    for (const u of p.untested) {
      const c = untested.get(u.text) ?? { text: u.text, files: 0 };
      c.files++;
      untested.set(u.text, c);
    }
    const t = titles.get(f.titleId) ?? { id: f.titleId, title: f.title, kind: f.kind, year: f.year, files: 0, counts: { direct: 0, remux: 0, audio: 0, video: 0 }, problems: new Set<string>(), worst: 'direct' as Verdict };
    t.files++;
    t.counts[p.verdict]++;
    for (const x of p.problems) t.problems.add(x.text);
    if (SEVERITY[p.verdict] > SEVERITY[t.worst]) t.worst = p.verdict;
    titles.set(f.titleId, t);
  }
  const affected = [...titles.values()]
    .filter((t) => t.worst !== 'direct')
    .sort((a, b) => SEVERITY[b.worst] - SEVERITY[a.worst] || b.counts[b.worst] - a.counts[a.worst] || a.title.localeCompare(b.title));
  return {
    device: summary(profile),
    capabilities: profile.capabilities,
    bitrateLimited: profile.bitrateLimited,
    scannedAt,
    files: files.length,
    counts,
    causes: [...causes.values()].sort((a, b) => SEVERITY[b.verdict] - SEVERITY[a.verdict] || b.files - a.files),
    untested: [...untested.values()].sort((a, b) => b.files - a.files).slice(0, 6),
    titles: affected.slice(0, 300).map((t) => ({ ...t, problems: [...t.problems] })),
    moreTitles: Math.max(0, affected.length - 300),
  };
}

/** "Will it play?" for one movie or series (its files), on every household device. */
export function titleReport(all: DeviceProfile[], files: LibraryFile[]) {
  const devices = householdDevices(all);
  return {
    files: files.length,
    devices: devices.map((d) => {
      const results = files.map((f) => bestOf(d, f));
      const counts: Record<Verdict, number> = { direct: 0, remux: 0, audio: 0, video: 0 };
      for (const r of results) counts[r.p.verdict]++;
      const worst = results.reduce<Prediction | undefined>((w, r) => (!w || SEVERITY[r.p.verdict] > SEVERITY[w.verdict] ? r.p : w), undefined);
      const uniq = (xs: { text: string }[]) => [...new Set(xs.map((x) => x.text))];
      return {
        ...summary(d),
        verdict: worst?.verdict ?? 'direct',
        counts,
        problems: uniq(results.flatMap((r) => r.p.problems)),
        untested: uniq(results.flatMap((r) => r.p.untested)),
        subtitleWarning: results.map((r) => r.p.subtitleWarning).find(Boolean),
        // For a movie with several versions: the one that plays best here.
        version: files.length === 1 && files[0]!.versions.length > 1 ? results[0]?.name : undefined,
      };
    }),
  };
}
