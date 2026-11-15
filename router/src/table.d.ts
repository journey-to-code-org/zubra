export const ROUTES: 'routes';

export class RouteError extends Error {}

/** The path a component's place in `routes/` gives it (`routes/farms/[id]` → `/farms/:id`), or null. */
export function folderPattern(name: string): string | null;
/** A pathname pattern's named parameters, in order. */
export function patternParams(pattern: string): string[];

export interface TableEntry {
  name: string;
  file?: string;
  props?: string[];
  route: { kind: 'page' | 'layout'; pattern: string | null; params?: string[]; root?: boolean; load?: boolean; reads?: string[] | null };
}

export interface TablePage { name: string; file: string; pattern: string; params: string[]; load: boolean; root: boolean }

export function buildTable(entries: TableEntry[]): { pages: TablePage[]; layouts: TablePage[] };
export function matcher(pages: TablePage[], URLPattern: unknown): (pathname: string) => { page: TablePage; params: Record<string, string> } | null;
