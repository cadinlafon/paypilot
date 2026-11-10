import { useSearchParams, Link } from "react-router-dom";
import { CheckCircle2, XCircle } from "lucide-react";
import { Logo } from "@/components/layout/Sidebar";

/** Public landing page after a payer completes (or cancels) a PayPilot payment link on PayPal. */
export default function PayReturn() {
  const [p] = useSearchParams();
  const ok = p.get("status") === "success";
  return (
    <div className="min-h-dvh grid grid-cols-1 place-items-center p-6">
      <div className="max-w-sm text-center">
        <div className="flex justify-center"><Logo /></div>
        <div className="mt-8 flex justify-center">{ok ? <CheckCircle2 className="size-10 text-accent" /> : <XCircle className="size-10 text-muted" />}</div>
        <h1 className="mt-4 text-lg font-semibold">{ok ? "Payment complete" : p.get("status") === "cancelled" ? "Payment cancelled" : "Payment not completed"}</h1>
        <p className="mt-2 text-sm text-muted">{ok ? "Thank you — your payment was received. A receipt is available from PayPal." : p.get("message") ?? "No money was taken. You can close this page or try the link again."}</p>
        <Link to="/" className="mt-6 inline-block text-xs text-faint hover:text-muted">Powered by PayPilot</Link>
      </div>
    </div>
  );
}
