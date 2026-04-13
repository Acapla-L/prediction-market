export function AccessGateLogo() {
  return (
    <div className="flex items-center justify-center gap-3">
      <div
        aria-hidden
        className="flex size-10 items-center justify-center rounded-md border border-border bg-card"
      >
        <span className="font-logo text-2xl font-bold text-primary">W</span>
      </div>
      <span className="font-logo text-2xl tracking-tight uppercase">
        <span className="font-bold">Wire</span>
        <span className="font-light">Predictions</span>
      </span>
    </div>
  )
}
