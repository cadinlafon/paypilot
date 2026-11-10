import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthLayout, GoogleIcon } from "./AuthLayout";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Form";
import { errorMessage, isEmail } from "@/lib/utils";
import { firebaseConfigured } from "@/lib/config";

export default function Register() {
  const { register, signInWithGoogle } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ name: "", email: "", password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const strong = f.password.length >= 10 && /[A-Za-z]/.test(f.password) && /\d/.test(f.password);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!f.name.trim()) return setError("Enter your name.");
    if (!isEmail(f.email)) return setError("Enter a valid email.");
    if (!strong) return setError("Use at least 10 characters with letters and numbers.");
    if (f.password !== f.confirm) return setError("Passwords don't match.");
    setBusy(true);
    try {
      await register(f.name.trim(), f.email.trim(), f.password);
      nav("/onboarding");
    } catch (err) {
      setError(/email-already-in-use/.test(String(err)) ? "An account with this email already exists." : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <AuthLayout title="Create your account" subtitle="We'll email you a link to verify your address." footer={<>Already have an account? <Link to="/login" className="text-accent-strong hover:underline">Sign in</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Full name">{(id) => <Input id={id} autoComplete="name" value={f.name} onChange={set("name")} disabled={!firebaseConfigured} />}</Field>
        <Field label="Work email">{(id) => <Input id={id} type="email" autoComplete="email" value={f.email} onChange={set("email")} disabled={!firebaseConfigured} />}</Field>
        <Field label="Password" hint={f.password && !strong ? "At least 10 characters, with letters and numbers" : undefined}>{(id) => <Input id={id} type="password" autoComplete="new-password" value={f.password} onChange={set("password")} disabled={!firebaseConfigured} />}</Field>
        <Field label="Confirm password">{(id) => <Input id={id} type="password" autoComplete="new-password" value={f.confirm} onChange={set("confirm")} disabled={!firebaseConfigured} />}</Field>
        {error && <p className="text-sm text-rose-300" role="alert">{error}</p>}
        <Button type="submit" variant="primary" className="w-full justify-center" loading={busy} disabled={!firebaseConfigured}>Create account</Button>
      </form>
      <Button className="w-full justify-center mt-3" icon={<GoogleIcon />} disabled={!firebaseConfigured} onClick={async () => { try { await signInWithGoogle(); nav("/onboarding"); } catch (e) { setError(errorMessage(e)); } }}>Sign up with Google</Button>
    </AuthLayout>
  );
}
