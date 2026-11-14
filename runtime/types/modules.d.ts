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
