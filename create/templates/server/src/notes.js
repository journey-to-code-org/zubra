// What the guest book has, kept in memory: it's gone when the server restarts. A real app reads
// and writes a database here; the component's server function is the only thing that calls it.
export const notes = ['Hello from the server'];

// The most it keeps, the oldest let go first: anyone who opens the page can sign it, and every
// page shows the whole list, so a list without an end would make each page heavier for good.
export const KEPT = 50;

export function addNote(text) {
  notes.push(text);
  if (notes.length > KEPT) notes.splice(0, notes.length - KEPT);
  return notes;
}
