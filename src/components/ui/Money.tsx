import { formatMoney } from "@shared/money";
import { cn } from "@/lib/utils";

export function Money({ amount, currency, className, sign, compact, muted }: { amount: number; currency: string; className?: string; sign?: boolean; compact?: boolean; muted?: boolean }) {
  return <span className={cn("tabular", muted && "text-muted", amount < 0 && sign && "text-rose-300", className)}>{formatMoney(amount, currency, { sign, compact })}</span>;
}

/** Original amount with converted reporting amount underneath, flagged when estimated. */
export function DualMoney({ amount, currency, reportingAmount, reportingCurrency, estimated, className }: { amount: number; currency: string; reportingAmount?: number; reportingCurrency: string; estimated?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex flex-col items-end leading-tight", className)}>
      <span className="tabular">{formatMoney(amount, currency)}</span>
      {currency !== reportingCurrency && (
        <span className="text-[11px] text-faint tabular" title={estimated ? "Converted with an estimated exchange rate" : "Converted to reporting currency"}>
          {reportingAmount !== undefined ? `≈ ${formatMoney(reportingAmount, reportingCurrency)}` : "no rate yet"}
          {estimated && " · est."}
        </span>
      )}
    </span>
  );
}
