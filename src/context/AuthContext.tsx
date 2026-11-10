import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { firebaseConfigured } from "@/lib/config";

export interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  photoURL?: string | null;
  /** Local guest session used when Firebase isn't configured (Demo only). */
  isGuest: boolean;
}

interface AuthCtx {
  user: AppUser | null;
  loading: boolean;
  firebaseUser: User | null;
  signIn(email: string, password: string): Promise<void>;
  register(name: string, email: string, password: string): Promise<void>;
  signInWithGoogle(): Promise<void>;
  resetPassword(email: string): Promise<void>;
  resendVerification(): Promise<void>;
  reloadUser(): Promise<void>;
  logout(): Promise<void>;
  continueAsGuest(): void;
}

const Ctx = createContext<AuthCtx | null>(null);
const GUEST_KEY = "paypilot:guest";

const toAppUser = (u: User): AppUser => ({
  uid: u.uid,
  email: u.email ?? "",
  displayName: u.displayName || u.email?.split("@")[0] || "User",
  emailVerified: u.emailVerified || u.providerData.some((p) => p.providerId === "google.com"),
  photoURL: u.photoURL,
  isGuest: false,
});

const GUEST: AppUser = { uid: "demo-guest", email: "alex.rivera@demo.paypilot.local", displayName: "Alex Rivera", emailVerified: true, isGuest: true };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth) {
      setUser(localStorage.getItem(GUEST_KEY) ? GUEST : null);
      setLoading(false);
      return;
    }
    return onAuthStateChanged(auth, (u) => {
      setFirebaseUser(u);
      setUser(u ? toAppUser(u) : localStorage.getItem(GUEST_KEY) ? GUEST : null);
      setLoading(false);
    });
  }, []);

  const need = () => {
    if (!auth) throw new Error("Sign-in is unavailable: Firebase isn't configured. You can explore Demo Mode as a guest.");
    return auth;
  };

  const value: AuthCtx = {
    user,
    loading,
    firebaseUser,
    async signIn(email, password) {
      await signInWithEmailAndPassword(need(), email, password);
    },
    async register(name, email, password) {
      const cred = await createUserWithEmailAndPassword(need(), email, password);
      await updateProfile(cred.user, { displayName: name });
      await sendEmailVerification(cred.user);
      setUser(toAppUser(cred.user));
    },
    async signInWithGoogle() {
      await signInWithPopup(need(), new GoogleAuthProvider());
    },
    async resetPassword(email) {
      await sendPasswordResetEmail(need(), email);
    },
    async resendVerification() {
      if (need().currentUser) await sendEmailVerification(need().currentUser!);
    },
    async reloadUser() {
      const u = need().currentUser;
      if (u) {
        await u.reload();
        await u.getIdToken(true);
        setUser(toAppUser(u));
      }
    },
    async logout() {
      localStorage.removeItem(GUEST_KEY);
      if (auth?.currentUser) await signOut(auth);
      setUser(null);
    },
    continueAsGuest() {
      localStorage.setItem(GUEST_KEY, "1");
      setUser(GUEST);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}

export { firebaseConfigured };
