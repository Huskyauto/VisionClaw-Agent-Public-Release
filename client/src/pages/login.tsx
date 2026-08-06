import { useState } from "react";
import { useLocation } from "wouter";
import { SeoHead } from "@/components/seo-head";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Shield, Loader2, ArrowLeft, Cpu, LogIn, Mail, Eye, EyeOff } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const { login, loginTenant, loginWithReplit } = useAuth();
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<"main" | "email" | "admin">("main");
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(pin);
      navigate("/");
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email.trim() || !password) {
      setError("Please enter your email and password");
      return;
    }
    setLoading(true);
    try {
      await loginTenant(email.trim(), password);
      navigate("/");
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SeoHead
        title="Sign In — VisionClaw Agent"
        description="Sign in to your VisionClaw Agent account. Access your AI agents, projects, conversations, and autonomous operations."
        canonical=""
      />
      <nav className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between gap-4 h-14">
          <button
            onClick={() => navigate("/landing")}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            data-testid="button-login-back"
          >
            <ArrowLeft className="w-4 h-4" />
            <Cpu className="w-5 h-5 text-primary" />
            <span className="font-bold text-lg">VisionClaw Agent</span>
          </button>
          <ThemeToggle />
        </div>
      </nav>

      <div className="flex items-center justify-center p-4 pt-24">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-2">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <LogIn className="w-6 h-6 text-primary" />
              </div>
            </div>
            <CardTitle data-testid="text-login-title">Welcome to VisionClaw Agent</CardTitle>
            <CardDescription>
              Sign in to your account
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {mode === "main" && (
              <>
                <Button
                  className="w-full h-12 text-base font-medium"
                  onClick={loginWithReplit}
                  data-testid="button-login-replit"
                >
                  <LogIn className="w-5 h-5 mr-2" />
                  Sign in with Google / Apple / GitHub
                </Button>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="bg-card px-2 text-muted-foreground">or</span>
                  </div>
                </div>

                <Button
                  variant="outline"
                  className="w-full h-11"
                  onClick={() => { setMode("email"); setError(""); }}
                  data-testid="button-login-email-option"
                >
                  <Mail className="w-4 h-4 mr-2" />
                  Sign in with Email
                </Button>

                <p className="text-xs text-center text-muted-foreground">
                  Don't have an account?{" "}
                  <button
                    type="button"
                    onClick={() => navigate("/signup")}
                    className="text-primary hover:underline"
                    data-testid="link-login-to-signup"
                  >
                    Sign up free
                  </button>
                </p>

                <button
                  type="button"
                  onClick={() => { setMode("admin"); setError(""); }}
                  className="w-full text-xs text-muted-foreground hover:text-foreground"
                  data-testid="button-login-toggle-mode"
                >
                  Admin PIN login
                </button>
              </>
            )}

            {mode === "email" && (
              <form onSubmit={handleEmailLogin} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="login-email">Email</Label>
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoFocus
                    data-testid="input-login-email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">Password</Label>
                  <div className="relative">
                    <Input
                      id="login-password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      data-testid="input-login-password"
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
                {error && (
                  <p className="text-sm text-destructive" data-testid="text-login-error">{error}</p>
                )}
                <Button
                  type="submit"
                  className="w-full h-11"
                  disabled={loading || !email || !password}
                  data-testid="button-login-submit-email"
                >
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Mail className="w-4 h-4 mr-2" />}
                  Sign In
                </Button>
                <button
                  type="button"
                  onClick={() => navigate("/forgot-password")}
                  className="w-full text-xs text-primary hover:underline"
                  data-testid="link-forgot-password"
                >
                  Forgot your password?
                </button>
                <p className="text-xs text-center text-muted-foreground">
                  Don't have an account?{" "}
                  <button
                    type="button"
                    onClick={() => navigate("/signup")}
                    className="text-primary hover:underline"
                    data-testid="link-email-to-signup"
                  >
                    Sign up free
                  </button>
                </p>
                <button
                  type="button"
                  onClick={() => { setMode("main"); setError(""); }}
                  className="w-full text-xs text-muted-foreground hover:text-foreground"
                  data-testid="button-login-back-main"
                >
                  Back to sign in options
                </button>
              </form>
            )}

            {mode === "admin" && (
              <form onSubmit={handleAdminSubmit} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="pin">Admin PIN</Label>
                  <Input
                    id="pin"
                    type="password"
                    placeholder="Enter admin PIN"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    autoFocus
                    data-testid="input-login-pin"
                  />
                </div>
                {error && (
                  <p className="text-sm text-destructive" data-testid="text-login-error">{error}</p>
                )}
                <Button
                  type="submit"
                  variant="outline"
                  className="w-full"
                  disabled={loading || !pin}
                  data-testid="button-login-submit"
                >
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Shield className="w-4 h-4 mr-2" />}
                  Unlock Admin
                </Button>
                <button
                  type="button"
                  onClick={() => { setMode("main"); setError(""); }}
                  className="w-full text-xs text-muted-foreground hover:text-foreground"
                  data-testid="button-login-hide-admin"
                >
                  Back to sign in options
                </button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
