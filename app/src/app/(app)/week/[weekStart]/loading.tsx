// Shown while a week loads (the prev/next arrows), so a tap gets an answer at once.
export default function WeekLoading() {
  return (
    <div className="space-y-4 pb-8" aria-busy="true" aria-label="Loading">
      <div className="mx-auto h-10 w-48 animate-pulse rounded-lg bg-border" />
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="h-40 animate-pulse rounded-xl bg-border" />
      ))}
    </div>
  );
}
