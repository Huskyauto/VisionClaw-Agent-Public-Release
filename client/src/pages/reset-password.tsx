import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Cpu, Loader2, Lock, CheckCircle, Eye, EyeOff } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { apiRequest } from "@/lib/queryClient";

export default function ResetPasswordPage() {
  const [, navigate] = useLocation();
  const searchString = useSearch();
  const params = new URLSearchParams(searchString);
  const token = params.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!token) {
      setError("Invalid reset link. Please request a new one.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (!/[a-z]/.test(password)) {
      setError("Password must include a lowercase letter");
      return;
    }
    if (!/[A-Z]/.test(password)) {
      setError("Password must include an uppercase letter");
      return;
    }
    if (!/\d/.test(password)) {
      setError("Password must include a number");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }

    setLoading(true);
    try {
      await apiRequest("POST", "/api/auth/reset-password", { token, password });
      setSuccess(true);
    } catch (err: any) {
      const msg = err.message || "";
      try {
        const parsed = JSON.parse(msg.replace(/^\d+:\s*/, ""));
        setError(parsed.error || "Something went wrong. Please try again.");
      } catch {
        setError(msg.includes("expired") ? "This reset link has expired. Please request a new one." : "Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <nav className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
          <div className="max-w-6xl mx-auto px-6 flex items-center justify-between gap-4 h-14">
            <button
              onClick={() => navigate("/login")}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
              data-testid="button-reset-back"
            >
              <ArrowLeft className="w-4 h-4" />
              <Cpu className="w-5 h-5 text-primary" />
              <span className="font-bold text-lg">VisionClaw</span>
            </button>
            <ThemeToggle />
          </div>
        </nav>
        <div className="flex items-center justify-center p-4 pt-24">
          <Card className="w-full max-w-sm">
            <CardHeader className="text-center">
              <CardTitle>Invalid Reset Link</CardTitle>
              <CardDescription>This password reset link is invalid or has expired.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                className="w-full"
                onClick={() => navigate("/forgot-password")}
                data-testid="button-reset-request-new"
              >
                Request a New Reset Link
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between gap-4 h-14">
          <button
            onClick={() => navigate("/login")}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            data-testid="button-reset-back"
          >
            <ArrowLeft className="w-4 h-4" />
            <Cpu className="w-5 h-5 text-primary" />
            <span className="font-bold text-lg">VisionClaw</span>
          </button>
          <ThemeToggle />
        </div>
      </nav>

      <div className="flex items-center justify-center p-4 pt-24">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-2">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                {success ? <CheckCircle className="w-6 h-6 text-green-500" /> : <Lock className="w-6 h-6 text-primary" />}
              </div>
            </div>
            <CardTitle data-testid="text-reset-title">
              {success ? "Password Reset!" : "Create New Password"}
            </CardTitle>
            <CardDescription>
              {success
                ? "Your password has been updated successfully."
                : "Enter your new password below."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {success ? (
              <Button
                className="w-full"
                onClick={() => navigate("/login")}
                data-testid="button-reset-to-login"
              >
                Sign In with New Password
              </Button>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="new-password">New Password</Label>
                  <div className="relative">
                    <Input
                      id="new-password"
                      type={showPassword ? "text" : "password"}
                      placeholder="At least 6 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoFocus
                      data-testid="input-reset-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      data-testid="button-toggle-password"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm Password</Label>
                  <Input
                    id="confirm-password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Re-enter your password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    data-testid="input-reset-confirm"
                  />
                </div>
                {error && (
                  <p className="text-sm text-destructive" data-testid="text-reset-error">{error}</p>
                )}
                <Button
                  type="submit"
                  className="w-full h-11"
                  disabled={loading || !password || !confirmPassword}
                  data-testid="button-reset-submit"
                >
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Lock className="w-4 h-4 mr-2" />}
                  Reset Password
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
