interface HomeV2HeroChartSkeletonProps {
  label?: string
}

export default function HomeV2HeroChartSkeleton({ label }: HomeV2HeroChartSkeletonProps) {
  return (
    <div
      className="
        relative flex h-[200px] w-full items-center justify-center overflow-hidden rounded-lg border border-dashed
        border-border/60 bg-muted/20
      "
    >
      <div className="absolute inset-x-0 bottom-0 h-px bg-linear-to-r from-transparent via-border/40 to-transparent" />
      {label && (
        <span className="text-2xs tracking-wider text-muted-foreground uppercase">
          {label}
        </span>
      )}
    </div>
  )
}
