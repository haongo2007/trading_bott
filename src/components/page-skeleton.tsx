export function PageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="skeleton h-8 w-56" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton h-20" />
        ))}
      </div>
      <div className="skeleton h-64 w-full" />
    </div>
  );
}
