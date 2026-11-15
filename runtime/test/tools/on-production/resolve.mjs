export async function resolve(specifier, context, next) {
  const result = await next(specifier, context);
  // The DevTools hook is development's alone, and has no production file.
  if (result.url.includes('/runtime/src/') && !/\/dev(?:tools|hook)\.js$/.test(result.url)) {
    return { ...result, url: result.url.replace('/runtime/src/', '/runtime/dist/production/') };
  }
  return result;
}
