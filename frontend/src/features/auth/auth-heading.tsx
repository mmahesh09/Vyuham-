export function AuthHeading({ title, subtitle }: { title: string; subtitle: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h1 className="font-display text-[30px] font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">{subtitle}</p>
    </div>
  );
}
