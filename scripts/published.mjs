// Which published compiler the WebAssembly job compares a build with when the
// registry's `latest` tarball is not fetchable yet (scripts used from ci.yml).
import { compareVersions } from './canary.mjs';

/** Newest published version other than the one this checkout is cutting. `versions` is unordered. */
export function previousPublished(versions, current) {
  const older = versions.filter((version) => version !== current).sort(compareVersions);
  if (!older.length) throw new Error(`no published @zubra/compiler other than ${current}`);
  return older.at(-1);
}
