import { Card } from "@/components/ui/card";

/**
 * Temporary scaffold for a module view. Lists the spec requirements the module
 * will satisfy so the roadmap is legible from the running app during Sprint 0.
 */
export function ModulePlaceholder({
  title,
  phase,
  requirements,
}: {
  title: string;
  phase: string;
  requirements: string[];
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-muted">Planned in {phase}.</p>
      </div>
      <Card>
        <div className="text-sm font-medium">Requirements to implement</div>
        <ul className="mt-3 space-y-1.5 text-sm text-muted">
          {requirements.map((r) => (
            <li key={r} className="flex gap-2">
              <span aria-hidden className="text-primary">
                •
              </span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
