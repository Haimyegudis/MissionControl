// Lumo card source → label + color (ui-parity §10.10).

export interface LumoSourceMeta {
  label: string;
  color: string;
}

export function sourceMeta(source: string | null | undefined): LumoSourceMeta {
  const s = (source ?? '').toLowerCase();
  switch (s) {
    case 'jira':
      return { label: 'Jira', color: '#2563EB' };
    case 'confluence':
      return { label: 'Confluence', color: '#1D4ED8' };
    case 'testrail':
      return { label: 'TestRail', color: '#059669' };
    case 'github':
      return { label: 'GitHub', color: '#374151' };
    default: {
      const label = s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Lumo';
      return { label, color: '#4F46E5' };
    }
  }
}
