import { ForgotPasswordForm } from "./forgot-password-form";

// Self-serve password recovery entry point. Reachable while signed out — the
// middleware gate only covers /admin and /tenant.
export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
