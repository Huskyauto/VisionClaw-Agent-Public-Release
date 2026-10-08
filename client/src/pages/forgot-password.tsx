import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Cpu, Loader2, Mail, CheckCircle } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { apiRequest } from "@/lib/queryClient";

export default function ForgotPasswordPage() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email.trim()) {
      setError("Please enter your email address");
      return;
    }
    setLoading(true);
    try {
      await apiRequest("POST", "/api/auth/forgot-password", { email: email.trim() });
      setSent(true);
    } catch (err: any) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between gap-4 h-14">
          <button
            onClick={() => navigate("/login")}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            data-testid="button-forgot-back"
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
                {sent ? <CheckCircle className="w-6 h-6 text-green-500" /> : <Mail className="w-6 h-6 text-primary" />}
              </div>
            </div>
            <CardTitle data-testid="text-forgot-title">
              {sent ? "Check Your Email" : "Reset Password"}
            </CardTitle>
            <CardDescription>
              {sent
                ? "If an account exists with that email, we've sent a password reset link."
                : "Enter your email and we'll send you a link to reset your password."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {sent ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground text-center" data-testid="text-forgot-sent">
                  The link will expire in 1 hour. Check your spam folder if you don't see it.
                </p>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={() => navigate("/login")}
                  data-testid="button-forgot-back-login"
                >
                  Back to Sign In
                </Button>
                <button
                  type="button"
                  onClick={() => { setSent(false); setEmail(""); }}
                  className="w-full text-xs text-primary hover:underline"
                  data-testid="button-forgot-resend"
                >
                  Try a different email
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="reset-email">Email Address</Label>
                  <Input
                    id="reset-email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoFocus
                    data-testid="input-forgot-email"
                  />
                </div>
                {error && (
                  <p className="text-sm text-destructive" data-testid="text-forgot-error">{error}</p>
                )}
                <Button
                  type="submit"
                  className="w-full h-11"
                  disabled={loading || !email.trim()}
                  data-testid="button-forgot-submit"
                >
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Mail className="w-4 h-4 mr-2" />}
                  Send Reset Link
                </Button>
                <button
                  type="button"
                  onClick={() => navigate("/login")}
                  className="w-full text-xs text-muted-foreground hover:text-foreground"
                  data-testid="button-forgot-back-login"
                >
                  Back to Sign In
                </button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
