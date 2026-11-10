import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { FlaskConical } from "lucide-react";
import { AuthLayout, GoogleIcon } from "./AuthLayout";
import { useAuth } from "@/context/AuthContext";
import { useWorkspace } from "@/context/WorkspaceContext";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { errorMessage } from "@/lib/utils";
import { firebaseConfigured } from "@/lib/config";

export default function Login() {
  const { signIn, signInWithGoogle, continueAsGuest } = useAuth();
  const { requestMode } = useWorkspace();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const done = () => nav(loc.state?.from ?? "/", { replace: true });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy("email");
    try {
      await signIn(email.trim(), password);
      done();
    } catch (err) {
      setError(/invalid-credential|wrong-password|user-not-found/.test(String(err)) ? "Incorrect email or password." : errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <AuthLayout title="Sign in to PayPilot" subtitle="Welcome back." footer={<>New to PayPilot? <Link to="/register" className="text-accent-strong hover:underline">Create an account</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">{(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={!firebaseConfigured} />}</Field>
        <Field label={<span className="flex justify-between"><span>Password</span><Link to="/forgot-password" className="text-accent-strong hover:underline font-normal">Forgot?</Link></span>}>
          {(id) => <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} disabled={!firebaseConfigured} />}
        </Field>
        {error && <p className="text-sm text-rose-300" role="alert">{error}</p>}
        <Button type="submit" variant="primary" className="w-full justify-center" loading={busy === "email"} disabled={!firebaseConfigured}>Sign in</Button>
      </form>
      <div className="my-5 flex items-center gap-3 text-xs text-faint"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>
      <div className="space-y-2">
        <Button className="w-full justify-center" icon={<GoogleIcon />} disabled={!firebaseConfigured} loading={busy === "google"} onClick={async () => { setBusy("google"); setError(null); try { await signInWithGoogle(); done(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(null); } }}>Continue with Google</Button>
        <Button variant="outline" className="w-full justify-center border-amber-500/30 text-amber-200 hover:bg-amber-500/10" icon={<FlaskConical className="size-4" />} onClick={() => { continueAsGuest(); requestMode("demo"); nav("/"); }}>Explore the demo without an account</Button>
      </div>
    </AuthLayout>
  );
}
