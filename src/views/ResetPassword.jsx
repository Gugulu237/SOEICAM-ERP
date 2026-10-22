
/* localized-messages */
import { sourceMessage, uiMessage } from '@/lib/i18n';

/* localized-interface */
import { ui } from '@/lib/i18n';
import { useLocaleRender as useInterfaceLanguage } from '@/lib/localization';
import React, { useEffect, useState } from "react";
import { Link } from "@/lib/router";
import { erp } from "@/api/erpClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, Loader2, AlertTriangle } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";

export default function ResetPassword() {
  const interfaceLanguage = useInterfaceLanguage(); void interfaceLanguage;

  const [validSession, setValidSession] = useState(null);
  useEffect(() => { erp.auth.isAuthenticated().then(setValidSession).catch(() => setValidSession(false)); }, []);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError(sourceMessage("Passwords do not match"));
      return;
    }
    setLoading(true);
    try {
      await erp.auth.resetPassword({ newPassword });
      window.location.href = "/login";
    } catch (err) {
      setError(err.message || sourceMessage("Failed to reset password"));
    } finally {
      setLoading(false);
    }
  };

  if (validSession === null) return <AuthLayout icon={Lock} title={ui("Checking reset link")}><Loader2 className="animate-spin mx-auto" /></AuthLayout>;
  if (!validSession) {
    return (
      <AuthLayout
        icon={AlertTriangle}
        title={ui("Invalid reset link")}
        subtitle={ui("This password reset link is missing or invalid")}
        footer={
          <Link to="/forgot-password" className="text-primary font-medium hover:underline">{ui("Request a new link")}</Link>
        }
      >
        <p className="text-sm text-foreground text-center">{ui("The link you used appears to be incomplete. Please request a new password reset email.")}</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      icon={Lock}
      title={ui("New password")}
      subtitle={ui("Enter your new password below")}
    >
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          {uiMessage(error)}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">{ui("New Password")}</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              autoFocus
              placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="pl-10 h-12"
              minLength={8}
              required
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">{ui("Confirm Password")}</Label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="pl-10 h-12"
              minLength={8}
              required
            />
          </div>
        </div>
        <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />{ui("Resetting...")}</>
          ) : (
            ui("Reset password")
          )}
        </Button>
      </form>
    </AuthLayout>
  );
}
