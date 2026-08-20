/**
 * Brain Bundle lookups — ports of Lumo's assistantAgent.js tool cases that
 * read the pre-extracted knowledge JSONs under <LUMO_ROOT>/data/brain/.
 * All lookups lazy-load + cache per file mtime (readJsonCached) and return
 * plain data objects; missing files degrade to found:false / hint results.
 */
import { existsSync } from 'node:fs';
import { readJsonCached, lumoPath } from './env.js';

type Rec = Record<string, any>;

const lc = (s: unknown): string => String(s ?? '').toLowerCase();
/** S5 shares the S4 automation/TestRail brain pipeline by product design. */
const brainSeries = (value: unknown): string => {
  const series = lc(value || 's6');
  return series === 's5' ? 's4' : series;
};

function terms(query: unknown): string[] {
  return lc(query)
    .split(/[\s,_-]+/)
    .filter((t) => t.length >= 3);
}

function brainFile(name: string): string {
  return lumoPath('data', 'brain', name);
}

function systemsKb(series: string): Rec {
  const normalized = brainSeries(series);
  const kb = readJsonCached<Rec>(brainFile(`systems-${normalized}.json`));
  return (
    kb ?? {
      version: 1,
      series: normalized,
      ingestedAt: null,
      sourcePages: [],
      components: [],
      monitors: [],
      events: [],
      parameters: [],
      configTypes: {},
      diagrams: [],
      stateTransitions: [],
      availabilities: [],
    }
  );
}

// ---------------------------------------------------------------------------
// systems-<series>.json lookups
// ---------------------------------------------------------------------------

export function lookupComponent(args: Rec): Rec {
  const series = brainSeries(args.series);
  const id = String(args.componentId ?? '').trim();
  const query = lc(args.query ?? '').trim();
  if (!id && !query) return { error: 'componentId or query required' };
  const kb = systemsKb(series);
  let matches: Rec[];
  if (id) {
    matches = (kb.components || []).filter(
      (c: Rec) => lc(c.id) === id.toLowerCase() || lc(c.id).includes(id.toLowerCase()),
    );
  } else {
    const qTerms = terms(query);
    matches = (kb.components || []).filter((c: Rec) =>
      qTerms.every((t) =>
        [c.id, c.type, c.cabinet, c.configType, c.description].some((f) => lc(f).includes(t)),
      ),
    );
  }
  if (!matches.length) return { found: false, componentId: id || null, query: query || null };
  const enriched = matches.slice(0, 200).map((comp: Rec) => {
    const monitors = (kb.monitors || []).filter((m: Rec) => lc(m.component) === lc(comp.id));
    const eventNames = new Set<string>();
    for (const m of monitors) for (const e of m.errorEvents || []) eventNames.add(e);
    const events = (kb.events || []).filter((e: Rec) => eventNames.has(e.name));
    const paramNames = new Set<string>();
    for (const m of monitors) {
      if (m.startDelayParam) paramNames.add(m.startDelayParam);
      if (m.errorDelayParam) paramNames.add(m.errorDelayParam);
    }
    const params = (kb.parameters || []).filter((p: Rec) => paramNames.has(p.name));
    return { component: comp, monitors, events, parameters: params };
  });
  return { found: true, count: enriched.length, results: enriched };
}

export function lookupEvent(args: Rec): Rec {
  const series = brainSeries(args.series);
  const name = String(args.eventName ?? '').trim();
  const query = lc(args.query ?? '').trim();
  if (!name && !query) return { error: 'eventName or query required' };
  const kb = systemsKb(series);
  let matches: Rec[];
  if (name) {
    matches = (kb.events || []).filter(
      (e: Rec) => lc(e.name) === name.toLowerCase() || lc(e.name).includes(name.toLowerCase()),
    );
  } else {
    const qTerms = terms(query);
    matches = (kb.events || []).filter((e: Rec) =>
      qTerms.every((t) =>
        [e.name, e.description, e.whatToDo, e.suspectedCause, e.trigger].some((f) =>
          lc(f).includes(t),
        ),
      ),
    );
  }
  if (!matches.length) return { found: false, eventName: name || null, query: query || null };
  const enriched = matches.slice(0, 200).map((ev: Rec) => {
    const monitors = (kb.monitors || []).filter((m: Rec) =>
      (m.errorEvents || []).some((en: string) => lc(en) === lc(ev.name)),
    );
    const componentIds = [...new Set(monitors.map((m: Rec) => m.component).filter(Boolean))];
    const components = (kb.components || []).filter((c: Rec) => componentIds.includes(c.id));
    return { event: ev, raisedBy: monitors, components };
  });
  return { found: true, count: enriched.length, results: enriched };
}

export function lookupParameter(args: Rec): Rec {
  const series = brainSeries(args.series);
  const name = String(args.paramName ?? '').trim();
  const query = lc(args.query ?? '').trim();
  if (!name && !query) return { error: 'paramName or query required' };
  const kb = systemsKb(series);
  let matches: Rec[];
  if (name) {
    matches = (kb.parameters || []).filter(
      (p: Rec) => lc(p.name) === name.toLowerCase() || lc(p.name).includes(name.toLowerCase()),
    );
  } else {
    const qTerms = terms(query);
    matches = (kb.parameters || []).filter((p: Rec) =>
      qTerms.every((t) => [p.name, p.description, p.scope, p.unit].some((f) => lc(f).includes(t))),
    );
  }
  if (!matches.length) return { found: false, paramName: name || null, query: query || null };
  const enriched = matches.slice(0, 200).map((p: Rec) => {
    const monitors = (kb.monitors || []).filter(
      (m: Rec) => m.startDelayParam === p.name || m.errorDelayParam === p.name,
    );
    return { parameter: p, referencedBy: monitors };
  });
  return { found: true, count: enriched.length, results: enriched };
}

export function listComponents(args: Rec): Rec {
  const kb = systemsKb(brainSeries(args.series));
  let comps: Rec[] = kb.components || [];
  if (args.cabinet) {
    comps = comps.filter((c) => lc(c.cabinet).includes(lc(args.cabinet)));
  }
  if (args.type) {
    // Normalize so "e-fuse"/"efuses"/"E-Fuse" all match stored "efuse"
    const norm = (s: unknown) =>
      lc(s)
        .replace(/[^a-z0-9]/g, '')
        .replace(/s$/, '');
    comps = comps.filter((c) => norm(c.type) === norm(args.type));
  }
  return {
    count: comps.length,
    components: comps.map((c) => {
      const pid = String(c.sourceUrl || '').match(/pageId=(\d+)/);
      return {
        id: c.id,
        type: c.type,
        cabinet: c.cabinet || null,
        description: String(c.description || '').slice(0, 140),
        ...(pid ? { pageId: pid[1] } : {}),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// code-signal-index.json — find_signal_in_code
// ---------------------------------------------------------------------------

function signalIndexFile(series?: string): string {
  const s = lc(series ?? '');
  if (s) {
    const cfg = readJsonCached<Rec>(lumoPath('config', 'series-config.json'));
    if (cfg?.series?.[s]?.isolatedCodeIndex) {
      return brainFile(`code-signal-index-${s}.json`);
    }
  }
  return brainFile('code-signal-index.json');
}

export function findSignalInCode(args: Rec): Rec {
  const signalPath = String(args.path ?? '').trim();
  if (!signalPath) return { error: 'path required' };
  const data = readJsonCached<Rec>(signalIndexFile(args.series as string | undefined));
  if (!data) return { exists: false, exact: false, locations: [] };
  const idx: Rec = data.index || {};
  if (idx[signalPath]) return { exists: true, exact: true, locations: idx[signalPath] };
  // Loose match: collapse digits → 'x' and bracketed indices
  const norm = (p: string) => p.replace(/\d+/g, 'x').replace(/\[[^\]]*\]/g, '[x]');
  const target = norm(signalPath);
  for (const [k, locs] of Object.entries(idx)) {
    if (norm(k) === target) return { exists: true, exact: false, locations: locs };
  }
  return { exists: false, exact: false, locations: [] };
}

// ---------------------------------------------------------------------------
// code-knowledge-<series>.json — helpers + signal usage
// ---------------------------------------------------------------------------

export function findHelpersForComponent(args: Rec): Rec {
  const series = brainSeries(args.series);
  const comp = String(args.component ?? '').trim();
  const query = lc(args.query ?? '').trim();
  const file = brainFile(`code-knowledge-${series}.json`);
  if (!existsSync(file)) {
    return { found: false, hint: 'code knowledge file not built yet' };
  }
  const kb = readJsonCached<Rec>(file) ?? {};
  const compU = comp.toUpperCase();
  const qTerms = terms(query);
  const compMatch = (it: Rec) => (comp ? lc(it.component).toUpperCase().includes(compU) : false);
  const textMatch = (it: Rec) =>
    qTerms.length > 0 &&
    qTerms.every((t) =>
      [it.className, it.method, it.purpose, it.signature, it.baseClass, it.mainFlow, it.component].some(
        (f) => lc(f).includes(t),
      ),
    );
  const match = (it: Rec) => compMatch(it) || textMatch(it);
  const helpers = ((kb.helpers as Rec[]) || []).filter(match).slice(0, 40);
  const wrappers = ((kb.testWrappers as Rec[]) || []).filter(match).slice(0, 20);
  return { component: comp || null, query: query || null, helpers, wrappers };
}

export function findSignalUsage(args: Rec): Rec {
  const series = brainSeries(args.series);
  const file = brainFile(`code-knowledge-${series}.json`);
  if (!existsSync(file)) return { found: false, hint: 'code knowledge file not built yet' };
  const kb = readJsonCached<Rec>(file) ?? {};
  const q = lc(args.signalOrComponent ?? '');
  if (!q) return { error: 'signalOrComponent required' };
  const usage = ((kb.signalUsage as Rec[]) || []).filter(
    (u) => lc(u.signal).includes(q) || lc(u.component).includes(q),
  );
  return { series, count: usage.length, usage: usage.slice(0, 30) };
}

// ---------------------------------------------------------------------------
// testrail-knowledge-<series>.json — find_test_scenarios
// ---------------------------------------------------------------------------

export function findTestScenarios(args: Rec): Rec {
  const series = brainSeries(args.series);
  const file = brainFile(`testrail-knowledge-${series}.json`);
  if (!existsSync(file)) return { found: false, hint: 'testrail knowledge file not built yet' };
  const kb = readJsonCached<Rec>(file) ?? {};

  const compRaw = String(args.component ?? '').trim();
  const queryRaw = String(args.query ?? '').trim();
  const comp = compRaw.toUpperCase();
  const qTerms = terms(queryRaw);

  const tagHit = (s: Rec) => (comp ? String(s.component || '').toUpperCase().includes(comp) : false);
  const textBlob = (obj: Rec) => JSON.stringify(obj).toLowerCase();
  const textHit = (s: Rec) => qTerms.length > 0 && qTerms.every((t) => textBlob(s).includes(t));
  const match = (s: Rec) => tagHit(s) || textHit(s);

  const scenarios = ((kb.scenarios as Rec[]) || []).filter(match).slice(0, 30);
  const setups = ((kb.setupPatterns as Rec[]) || []).filter(match).slice(0, 15);
  const verifs = ((kb.verificationPatterns as Rec[]) || []).filter(match).slice(0, 20);

  const componentsFound = [...new Set(scenarios.map((s) => s.component).filter(Boolean))];
  const signalsByComp: Rec = {};
  for (const c of componentsFound) {
    const sigs = ((kb.commonSignalsByComponent as Rec) || {})[c] || [];
    if (sigs.length) signalsByComp[c] = sigs.slice(0, 15);
  }

  return {
    query: queryRaw || null,
    componentRequested: compRaw || null,
    componentsFound,
    scenarios,
    setupPatterns: setups,
    verificationPatterns: verifs,
    signalsByComponent: signalsByComp,
    note:
      scenarios.length === 0
        ? 'No matches. Try a broader query or check componentsFound from a related call.'
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// Brain store entries (index.json + entries/<id>.json)
// ---------------------------------------------------------------------------

function brainEntriesWithContent(): Rec[] {
  const index = readJsonCached<Rec>(brainFile('index.json'));
  if (!index || !Array.isArray(index.entries)) return [];
  const out: Rec[] = [];
  for (const meta of index.entries as Rec[]) {
    const full = readJsonCached<Rec>(brainFile(`entries/${meta.id}.json`));
    if (full) out.push(full);
  }
  return out;
}

export function lookupInvestigation(args: Rec): Rec {
  const all = brainEntriesWithContent();
  const investigations = all.filter(
    (e) => e.type === 'investigation' || /^investigation:/i.test(String(e.source || '')),
  );
  const issueKey = String(args.issueKey ?? '').toUpperCase().trim();
  const component = lc(args.component ?? '');
  const queryTerms = terms(args.query ?? '');

  let matches = investigations;
  if (issueKey) {
    matches = matches.filter(
      (e) =>
        (e.tags || []).map((t: unknown) => String(t).toUpperCase()).includes(issueKey) ||
        lc(e.name).includes(lc(issueKey)),
    );
  }
  if (component) {
    matches = matches.filter(
      (e) =>
        (e.tags || []).some((t: unknown) => lc(t).includes(component)) ||
        lc(e.content).includes(component),
    );
  }
  if (queryTerms.length) {
    matches = matches.filter((e) =>
      queryTerms.every(
        (t) =>
          lc(e.name).includes(t) ||
          lc(e.description).includes(t) ||
          lc(e.content).includes(t) ||
          (e.tags || []).some((tag: unknown) => lc(tag).includes(t)),
      ),
    );
  }
  const mapped = matches.slice(0, 10).map((e) => ({
    id: e.id,
    name: e.name,
    description: e.description,
    tags: e.tags,
    source: e.source,
    content: String(e.content || '').slice(0, 4000),
  }));
  return { found: mapped.length > 0, count: mapped.length, results: mapped };
}

export function lookupCalibrationPattern(args: Rec): Rec {
  const all = brainEntriesWithContent();
  const entries = all.filter(
    (e) =>
      String(e.source || '').includes('create-calibration') ||
      (e.tags || []).map((t: unknown) => lc(t)).includes('calibration'),
  );
  const qTerms = terms(args.query ?? '');
  let content: string = entries[0]?.content || '';
  if (qTerms.length && content) {
    const paragraphs = content.split(/\n{2,}/);
    const matched = paragraphs.filter((p) => qTerms.some((t) => lc(p).includes(t)));
    if (matched.length) content = matched.join('\n\n');
  }
  return {
    found: entries.length > 0,
    entries: entries.map((e) => ({
      id: e.id,
      name: e.name,
      description: e.description,
      tags: e.tags,
      source: e.source,
    })),
    content: content.slice(0, 8000),
    note: entries.length === 0 ? 'No calibration pattern entry found in the brain store.' : undefined,
  };
}

export function lookupFailureMethodology(args: Rec): Rec {
  const all = brainEntriesWithContent();
  const topic = lc(args.topic ?? '');
  const queryTerms = terms(args.query ?? '');

  const candidates = all.filter(
    (e) =>
      String(e.source || '').includes('failure-investigation') ||
      (e.tags || []).some((t: unknown) => /failure|investigation|negative/i.test(String(t))),
  );

  let matches = candidates;
  if (topic) {
    matches = matches.filter(
      (e) =>
        lc(e.name).includes(topic) ||
        (e.tags || []).some((t: unknown) => lc(t).includes(topic)) ||
        lc(e.content).includes(topic),
    );
  }
  if (queryTerms.length) {
    matches = matches.filter((e) =>
      queryTerms.every(
        (t) =>
          lc(e.content).includes(t) ||
          lc(e.name).includes(t) ||
          (e.tags || []).some((tag: unknown) => lc(tag).includes(t)),
      ),
    );
  }

  const excerpts = matches.slice(0, 4).map((e) => {
    let snippet: string = e.content || '';
    if (queryTerms.length && snippet.length > 4000) {
      const lines = snippet.split('\n');
      const hitLines: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        if (queryTerms.some((t) => lc(lines[i]).includes(t))) {
          const start = Math.max(0, i - 3);
          const end = Math.min(lines.length, i + 8);
          hitLines.push(lines.slice(start, end).join('\n'));
        }
      }
      snippet = hitLines.length ? hitLines.join('\n---\n').slice(0, 6000) : snippet.slice(0, 6000);
    } else {
      snippet = snippet.slice(0, 6000);
    }
    return {
      id: e.id,
      name: e.name,
      description: e.description,
      tags: e.tags,
      source: e.source,
      excerpt: snippet,
    };
  });
  return {
    found: excerpts.length > 0,
    count: excerpts.length,
    excerpts,
    note: excerpts.length === 0 ? 'No failure-methodology entry matched in the brain store.' : undefined,
  };
}
