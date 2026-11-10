import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { WorkspaceProvider } from "@/context/WorkspaceContext";
import { ToastProvider } from "@/components/ui/Toast";
import { AppShell, RequirePermission } from "@/components/layout/AppShell";
import { FullPageLoader } from "@/components/ui/Feedback";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import type { Permission } from "@shared/types";

const Login = lazy(() => import("@/pages/auth/Login"));
const Register = lazy(() => import("@/pages/auth/Register"));
const ForgotPassword = lazy(() => import("@/pages/auth/ForgotPassword"));
const Onboarding = lazy(() => import("@/pages/Onboarding"));
const Overview = lazy(() => import("@/pages/Overview"));
const Assistant = lazy(() => import("@/pages/Assistant"));
const Transactions = lazy(() => import("@/pages/Transactions"));
const Invoices = lazy(() => import("@/pages/Invoices"));
const PaymentLinks = lazy(() => import("@/pages/PaymentLinks"));
const Subscriptions = lazy(() => import("@/pages/Subscriptions"));
const Expenses = lazy(() => import("@/pages/Expenses"));
const Customers = lazy(() => import("@/pages/Customers"));
const CustomerProfile = lazy(() => import("@/pages/CustomerProfile"));
const Products = lazy(() => import("@/pages/Products"));
const Analytics = lazy(() => import("@/pages/Analytics"));
const Automations = lazy(() => import("@/pages/Automations"));
const Notifications = lazy(() => import("@/pages/Notifications"));
const Integrations = lazy(() => import("@/pages/Integrations"));
const Settings = lazy(() => import("@/pages/Settings"));
const PayReturn = lazy(() => import("@/pages/PayReturn"));

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  if (user && !user.isGuest) return <Navigate to="/" replace />;
  return <>{children}</>;
}

const P = (perm: Permission, el: ReactNode) => <RequirePermission permission={perm}>{el}</RequirePermission>;

export function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <WorkspaceProvider>
            <BrowserRouter>
              <Suspense fallback={<FullPageLoader />}>
                <Routes>
                  <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
                  <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
                  <Route path="/forgot-password" element={<ForgotPassword />} />
                  <Route path="/pay/return" element={<PayReturn />} />
                  <Route path="/onboarding" element={<Protected><Onboarding /></Protected>} />
                  <Route element={<Protected><AppShell /></Protected>}>
                    <Route index element={<Overview />} />
                    <Route path="assistant" element={P("ai.use", <Assistant />)} />
                    <Route path="transactions" element={P("transactions.view", <Transactions />)} />
                    <Route path="invoices" element={P("invoices.view", <Invoices />)} />
                    <Route path="payment-links" element={P("paymentLinks.view", <PaymentLinks />)} />
                    <Route path="subscriptions" element={P("subscriptions.view", <Subscriptions />)} />
                    <Route path="expenses" element={P("expenses.view", <Expenses />)} />
                    <Route path="customers" element={P("customers.view", <Customers />)} />
                    <Route path="customers/:id" element={P("customers.view", <CustomerProfile />)} />
                    <Route path="products" element={P("products.view", <Products />)} />
                    <Route path="analytics" element={P("reports.view", <Analytics />)} />
                    <Route path="automations" element={P("automations.view", <Automations />)} />
                    <Route path="notifications" element={P("notifications.view", <Notifications />)} />
                    <Route path="integrations" element={<Integrations />} />
                    <Route path="settings" element={<Settings />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Route>
                </Routes>
              </Suspense>
            </BrowserRouter>
          </WorkspaceProvider>
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
