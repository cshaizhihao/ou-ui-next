export function createControlPlaneTestClock(startSequence = 0) {
  let sequence = startSequence;

  return () => new Date(Date.UTC(2026, 5, 2, 0, 0, sequence++)).toISOString();
}
