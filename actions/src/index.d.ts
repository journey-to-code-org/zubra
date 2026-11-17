export const MOUNT: '/_zb/action/';
export const SCRIPT_PATH: '/_zb/actions.js';
export const COOKIE: '__zb_result';

export interface ActionsOptions {
  /** The folder of `.zb` files. Default: `components`. */
  components?: string;
  /** Where the components' server halves are written. Default: `node_modules/.cache/zubra-actions`. */
  cacheDir?: string;
  /** Other origins allowed to post, beyond the request's own. */
  origins?: string[];
  /** Called when a server function throws. The client gets a generic error either way. */
  onError?: (error: unknown, request: Request) => void;
  /** Serve the browser scripts minified. Default: true when `NODE_ENV` is `production`. */
  production?: boolean;
  /**
   * The largest post read, files and fields together, in bytes: 10 MB by default, `Infinity` for
   * no limit. A bigger one gets `{ error: 'Too large' }` (status 413) and the function doesn't run.
   */
  maxBytes?: number;
  /**
   * Whether the app is served over HTTPS, for the result cookie (`__Host-` and `Secure`): true behind
   * a proxy that ends TLS, whose requests arrive as http. Unset: each request's own protocol.
   */
  secure?: boolean;
  /**
   * What else a server function gets beside `request`, per request: the signed-in user, a
   * database handle. `req` is Node's request (Node, Express, Fastify); `c` is Hono's context.
   */
  context?: (from: { request: Request; req?: import('node:http').IncomingMessage; c?: unknown }) => object | Promise<object>;
}

export interface ActionResult<T = unknown> {
  /** The action's URL, `/_zb/action/<tag>/<name>`. */
  action: string;
  value: T;
}

export interface Actions {
  /** A Response for an action or the client script; null for any other request. */
  fetch(request: Request, extra?: { req?: import('node:http').IncomingMessage; c?: unknown }): Promise<Response | null>;
  /** Node's http: answers ours and resolves true, else false without reading the body. */
  handle(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): Promise<boolean>;
  /** After a no-JavaScript post, its result, once; `setHeader` gets the header that clears it. */
  result<T = unknown>(
    request: Request | import('node:http').IncomingMessage,
    setHeader?: (name: string, value: string) => void,
  ): ActionResult<T> | null;
  /** Every action's URL. */
  routes(): string[];
  /** The `<script type="module">` that enhances action forms. */
  script(): string;
  /** Experimental. The `<script type="module">` for `@zubra/actions/enhance-forms`: plain forms that name what they update (`data-zb-updates`) post without a reload. */
  formsScript(): string;
  /** A `Set-Cookie` value that clears the result cookie. */
  clearCookie: string;
}

/** What a server function receives besides its FormData. */
export interface ActionContext {
  request: Request;
  /** And whatever `context()` returned. */
  [key: string]: unknown;
}

export function createActions(options?: ActionsOptions): Promise<Actions>;
/** Throws for a Host header that isn't a host and an optional port (answer 400). */
export function toRequest(req: import('node:http').IncomingMessage): Request;
export function send(response: Response, res: import('node:http').ServerResponse): Promise<void>;
