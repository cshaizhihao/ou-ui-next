export function EnvironmentBackdrop() {
  return (
    <div className="bg-env ou-shell-backdrop" aria-hidden="true">
      <span className="ou-shell-color-block ou-shell-color-block-primary" />
      <span className="ou-shell-color-block ou-shell-color-block-accent" />
      <span className="ou-shell-color-block ou-shell-color-block-signal" />
      <div className="ou-shell-grid" />
      <div className="ou-shell-ribbon" data-ribbon="Control Plane Operations Host Delivery Audit" />
    </div>
  );
}
