// What the guest book has, kept in memory: it's gone when the server restarts. A real app reads
// and writes a database here; the component's server function is the only thing that calls it.
export const notes = ['Hello from the server'];

export function addNote(text) {
  notes.push(text);
  return notes;
}
