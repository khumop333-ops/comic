export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 w-48 rounded bg-neutral-200" />
      <div className="h-4 w-80 rounded bg-neutral-200" />
      <div className="rounded-2xl border bg-white p-6">
        <div className="h-32 rounded-xl bg-neutral-100" />
      </div>
    </div>
  );
}
