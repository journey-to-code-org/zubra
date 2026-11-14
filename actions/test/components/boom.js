// Imported only by farm-page's `load`: @zubra/actions must never import a route's server half.
throw new Error('a route\'s load module was imported by @zubra/actions');
export const boom = (id) => id;
