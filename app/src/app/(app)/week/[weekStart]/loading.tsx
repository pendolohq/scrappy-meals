// Shown while a week loads (the prev/next arrows), so a tap gets an answer at once.
export default function WeekLoading() {
  return (
    <div className="space-y-5 pb-8" aria-busy="true" aria-label="Loading">
      <div className="flex items-end justify-between">
        <div className="space-y-2">
          <div className="h-9 w-44 animate-pulse rounded-control bg-sunken" />
          <div className="h-4 w-28 animate-pulse rounded-control bg-sunken" />
        </div>
        <div className="flex gap-2">
          <div className="size-tap animate-pulse rounded-full bg-sunken" />
          <div className="size-tap animate-pulse rounded-full bg-sunken" />
        </div>
      </div>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="h-72 animate-pulse rounded-card bg-sunken" />
      ))}
    </div>
  );
}
