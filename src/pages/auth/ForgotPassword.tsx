import { useState } from "react";
import { Link } from "react-router-dom";
import { AuthLayout } from "./AuthLayout";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { firebaseConfigured } from "@/lib/config";

export default function ForgotPassword() {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <AuthLayout title="Reset your password" subtitle="Enter your email and we'll send a reset link." footer={<Link to="/login" className="text-accent-strong hover:underline">Back to sign in</Link>}>
      {sent ? (
        <p className="text-sm text-muted rounded-xl border border-line bg-surface p-4">If an account exists for <strong className="text-fg">{email}</strong>, a reset link is on its way. Check your inbox and spam folder.</p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            // Always show the same confirmation to avoid revealing which emails have accounts.
            await resetPassword(email.trim()).catch(() => undefined);
            setBusy(false);
            setSent(true);
          }}
        >
          <Field label="Email">{(id) => <Input id={id} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={!firebaseConfigured} />}</Field>
          <Button type="submit" variant="primary" className="w-full justify-center" loading={busy} disabled={!firebaseConfigured}>Send reset link</Button>
        </form>
      )}
    </AuthLayout>
  );
}
