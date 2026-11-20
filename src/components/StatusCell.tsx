import type { EvaluatedPlanningRecord } from '../shared/plannerTypes.ts';

export function RiskStatusDisplay({
  riskStatus,
  riskTier,
}: {
  riskStatus: string;
  riskTier: EvaluatedPlanningRecord['riskTier'];
}) {
  const colorClasses =
    riskTier === 'closed'
      ? 'bg-slate-100 text-slate-700 border-slate-300'
      : riskTier === 'plan_qty_pending'
        ? 'bg-amber-50 text-amber-800 border-amber-200'
        : riskTier === 'critical'
          ? 'bg-red-50 text-red-800 border-red-200'
          : riskTier === 'high'
            ? 'bg-orange-50 text-orange-800 border-orange-200'
            : riskTier === 'on_track'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-blue-50 text-blue-800 border-blue-200';

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-semibold whitespace-nowrap ${colorClasses}`}
    >
      {riskStatus}
    </span>
  );
}

export function ActionMessageDisplay({
  actionMessage,
  riskTier,
}: {
  actionMessage: string;
  riskTier: EvaluatedPlanningRecord['riskTier'];
}) {
  const textClass =
    riskTier === 'closed'
      ? 'text-slate-500 font-medium'
      : riskTier === 'plan_qty_pending'
        ? 'text-amber-800 font-semibold'
        : riskTier === 'critical'
          ? 'text-red-700 font-semibold'
          : riskTier === 'high'
            ? 'text-orange-700 font-medium'
            : riskTier === 'on_track'
              ? 'text-emerald-700 font-medium'
              : 'text-slate-700';

  return <span className={`text-xs ${textClass}`}>{actionMessage}</span>;
}
