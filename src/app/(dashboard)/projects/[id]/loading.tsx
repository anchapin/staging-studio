export default function Loading() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="flex flex-col items-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-stone-200 border-t-stone-600" />
        <p className="text-sm text-stone-600">Loading project...</p>
      </div>
    </div>
  );
}
