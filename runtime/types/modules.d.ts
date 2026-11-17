/**
 * The production build's modules (`dist/production/<name>`), each with the modules it imports
 * statically: what a server that sends the runtime file by file preloads. Generated with the
 * build; every module named is in the development build too.
 */
declare const modules: Record<string, string[]>;
export default modules;

/**
 * The same for the bundled build (`dist/bundled/<name>`), where the entry and the modules it
 * imports are one file, `zubra.js`.
 */
export declare const bundled: Record<string, string[]>;

/**
 * The split build (`dist/split/<name>`): `zubra.js` is the base (`base`, file by file), and
 * `names` says which file has each name of the script API that the base doesn't (`provide` is
 * `provide.js`'s, `$modified` is `modifiers.js`'s). `modules` is each of its modules' static
 * imports, as above. A server sends a page's modules each name from its file, so the page loads
 * only the files its components name.
 */
export declare const split: { base: string; names: Record<string, string>; modules: Record<string, string[]> };
