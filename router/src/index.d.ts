import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Zubra } from '@zubra/server';

export { RouteError } from './table.js';

/** What a route's `load` is given. */
export interface LoadArguments {
  /** The route's parameters (`{ id: 'hilltop' }` for `/farms/:id` at `/farms/hilltop`). */
  params: Record<string, string>;
  url: URL;
  request: Request;
  /** The page the request matched. */
  route: MatchedRoute;
}

/** What a layout or page that declares a `route` prop is given. */
export interface MatchedRoute {
  /** The request's path: `/farms/hilltop`. */
  path: string;
  /** The page's pattern: `/farms/:id`. */
  pattern: string;
  params: Record<string, string>;
}

export interface RouterOptions {
  /** The app's `createZubra()`: it renders the pages. */
  zubra: Zubra;
  /** The folder of components, the same one `zubra` reads (default `components`). */
  components?: string;
  /** Where the routes' server halves are written (default `node_modules/.cache/zubra-router`). */
  cacheDir?: string;
  /** Called when a `load` throws; the browser gets a plain 500. */
  onError?(error: unknown, request: Request): void;
  /** The document's language (default `en`). */
  lang?: string;
  /**
   * HTML for every page's `<head>` (fonts, a stylesheet), or a function returning it. Written
   * as given: the app's own markup, never a visitor's text.
   */
  head?: string | ((page: { url: URL; request: Request; route: MatchedRoute }) => string | Promise<string>);
}

export interface Route {
  /** The component, by its path in the folder without the extension. */
  name: string;
  /** A URLPattern pathname: `/farms/:id`. */
  pattern: string;
  params: string[];
  load: boolean;
  /** The layouts around it, outermost first, by name. */
  layouts: string[];
}

export interface Router {
  /** Node's http: answers a GET or HEAD to a route and resolves true, or resolves false. */
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
  /** For `http.createServer(router.listener)`: a route, or a plain 404. */
  listener(req: IncomingMessage, res: ServerResponse): Promise<void>;
  /** Fetch-style servers: the page's Response, or null when the request isn't a route's. */
  fetch(request: Request): Promise<Response | null>;
  /** The pages, most specific first. */
  routes(): Route[];
  /** The layouts, outermost first (`app.zb` is `/`). */
  layouts(): { name: string; pattern: string; root: boolean }[];
  /** Which page a path goes to, or null. */
  match(pathname: string): { name: string; pattern: string; params: Record<string, string> } | null;
}

export function createRouter(options: RouterOptions): Promise<Router>;
