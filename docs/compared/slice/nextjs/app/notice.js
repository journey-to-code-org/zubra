export function Notice({ said }) {
  if (said.problem) return <p className="notice problem" role="alert">{said.problem}</p>;
  if (said.done) return <p className="notice" role="status">{said.done}</p>;
  return null;
}
