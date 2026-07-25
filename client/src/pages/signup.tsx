import { useState } from "react";
import { useLocation } from "wouter";
import { SeoHead } from "@/components/seo-head";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Cpu, ArrowLeft, Check, Sparkles, LogIn, Mail, Loader2, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";

const PLANS = [
  { name: "Free Trial", price: 0, features: ["Full VisionClaw Agent experience", "5 conversations", "All 16 AI agents", "Voice, tools & memory"], trial: true },
  { name: "Starter", price: 29, features: ["1 AI persona", "100 conversations/mo", "Basic memory"] },
  { name: "Pro", price: 99, features: ["5 AI personas", "Unlimited conversations", "Full memory + voice"], popular: true },
  { name: "Enterprise", price: 299, features: ["Full 16-agent team", "Autonomous heartbeat", "Priority support"] },
];

function validatePasswordClient(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters";
  if (!/[a-z]/.test(password)) return "Password must include a lowercase letter";
  if (!/[A-Z]/.test(password)) return "Password must include an uppercase letter";
  if (!/\d/.test(password)) return "Password must include a number";
  return null;
}

export default function SignupPage() {
  const [, navigate] = useLocation();
  const { loginWithReplit, registerTenant } = useAuth();
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [verificationStep, setVerificationStep] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [pendingTenantId, setPendingTenantId] = useState<number | null>(null);
  const [pendingEmail, setPendingEmail] = useState("");
  const [resending, setResending] = useState(false);

  const handleEmailSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!name.trim()) {
      setError("Please enter your name");
      return;
    }
    if (!email.trim()) {
      setError("Please enter your email address");
      return;
    }
    const pwError = validatePasswordClient(password);
    if (pwError) {
      setError(pwError);
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const result = await registerTenant(email.trim(), password, name.trim());
      if (result && !result.emailVerified && result.tenantId) {
        setPendingTenantId(result.tenantId);
        setPendingEmail(result.email || email.trim());
        setVerificationStep(true);
      } else {
        navigate("/");
      }
    } catch (err: any) {
      setError(err.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await apiRequest("POST", "/api/auth/verify-email", {
        code: verificationCode.trim(),
      });
      const data = await res.json();
      if (data.verified) {
        navigate("/");
      }
    } catch (err: any) {
      setError(err.message || "Verification failed");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    setError("");
    try {
      await apiRequest("POST", "/api/auth/resend-verification", {});
    } catch {}
    setResending(false);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SeoHead
        title="Sign Up Free — VisionClaw Agent"
        description="Create your free VisionClaw Agent account. Access 16 AI agents with distinct personalities, 296 tools, 66 skills, and full document production. No credit card required. Start in 30 seconds."
        canonical=""
      />
      <nav className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between gap-4 h-14">
          <button
            onClick={() => navigate("/landing")}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            data-testid="button-signup-back"
          >
            <ArrowLeft className="w-4 h-4" />
            <Cpu className="w-5 h-5 text-primary" />
            <span className="font-bold text-lg">VisionClaw Agent</span>
          </button>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button
              variant="ghost"
              onClick={() => navigate("/login")}
              data-testid="button-signup-signin"
            >
              Sign In
            </Button>
          </div>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-6 py-16">
        {verificationStep ? (
          <div className="max-w-md mx-auto">
            <Card>
              <CardHeader className="text-center">
                <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                  <ShieldCheck className="w-6 h-6 text-primary" />
                </div>
                <CardTitle data-testid="text-verify-title">Check Your Email</CardTitle>
                <CardDescription>
                  We sent a 6-digit code to <strong>{pendingEmail}</strong>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleVerify} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="verify-code">Verification Code</Label>
                    <Input
                      id="verify-code"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      placeholder="000000"
                      value={verificationCode}
                      onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ""))}
                      className="text-center text-2xl tracking-widest font-mono"
                      autoFocus
                      data-testid="input-verify-code"
                    />
                  </div>
                  {error && (
                    <p className="text-sm text-destructive" data-testid="text-verify-error">{error}</p>
                  )}
                  <Button
                    type="submit"
                    className="w-full h-11"
                    disabled={loading || verificationCode.length !== 6}
                    data-testid="button-verify-submit"
                  >
                    {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                    Verify Email
                  </Button>
                  <div className="text-center">
                    <button
                      type="button"
                      onClick={handleResend}
                      disabled={resending}
                      className="text-sm text-muted-foreground hover:text-foreground"
                      data-testid="button-resend-code"
                    >
                      {resending ? "Sending..." : "Didn't get the code? Send again"}
                    </button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>
        ) : (
        <>
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold mb-2" data-testid="text-signup-title">Get Started with VisionClaw Agent</h1>
          <p className="text-muted-foreground">Create your account and start with 5 free conversations.</p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-10">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className="relative rounded-lg border-2 border-border p-4 text-left"
              data-testid={`card-plan-${plan.name.toLowerCase().replace(/\s+/g, "-")}`}
            >
              {plan.popular && (
                <span className="absolute -top-2.5 left-3 bg-primary text-primary-foreground text-xs font-medium px-2 py-0.5 rounded-full">
                  Popular
                </span>
              )}
              {plan.trial && (
                <span className="absolute -top-2.5 left-3 bg-amber-500 text-white text-xs font-medium px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Try Free
                </span>
              )}
              <div className="font-semibold">{plan.name}</div>
              <div className="flex items-baseline gap-0.5 mt-1 mb-3">
                {plan.price === 0 ? (
                  <span className="text-2xl font-bold">Free</span>
                ) : (
                  <>
                    <span className="text-2xl font-bold">${plan.price}</span>
                    <span className="text-sm text-muted-foreground">/mo</span>
                  </>
                )}
              </div>
              <ul className="space-y-1.5">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-1.5 text-sm text-muted-foreground">
                    <Check className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <Card className="max-w-md mx-auto">
          <CardHeader className="text-center">
            <CardTitle data-testid="text-signup-form-title">
              Create Your Account
            </CardTitle>
            <CardDescription>
              Choose how you'd like to sign up
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              className="w-full h-12 text-base font-medium"
              onClick={loginWithReplit}
              data-testid="button-signup-replit"
            >
              <LogIn className="w-5 h-5 mr-2" />
              Continue with Google / Apple / GitHub
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-card px-2 text-muted-foreground">or</span>
              </div>
            </div>

            {showEmailForm ? (
              <form onSubmit={handleEmailSignup} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="signup-name">Full Name</Label>
                  <Input
                    id="signup-name"
                    type="text"
                    placeholder="Your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                    data-testid="input-signup-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    data-testid="input-signup-email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Password</Label>
                  <div className="relative">
                    <Input
                      id="signup-password"
                      type={showPassword ? "text" : "password"}
                      placeholder="At least 8 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      data-testid="input-signup-password"
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
                  <Label htmlFor="signup-confirm">Confirm Password</Label>
                  <Input
                    id="signup-confirm"
                    type={showPassword ? "text" : "password"}
                    placeholder="Confirm your password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    data-testid="input-signup-confirm-password"
                  />
                </div>
                {error && (
                  <p className="text-sm text-destructive" data-testid="text-signup-error">{error}</p>
                )}
                <Button
                  type="submit"
                  className="w-full h-11"
                  disabled={loading || !email || !password || !name}
                  data-testid="button-signup-submit"
                >
                  {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Mail className="w-4 h-4 mr-2" />}
                  Create Account
                </Button>
                <button
                  type="button"
                  onClick={() => { setShowEmailForm(false); setError(""); }}
                  className="w-full text-xs text-muted-foreground hover:text-foreground"
                  data-testid="button-signup-back-options"
                >
                  Back to sign up options
                </button>
              </form>
            ) : (
              <Button
                variant="outline"
                className="w-full h-11"
                onClick={() => setShowEmailForm(true)}
                data-testid="button-signup-email"
              >
                <Mail className="w-4 h-4 mr-2" />
                Sign up with Email
              </Button>
            )}

            <p className="text-xs text-center text-muted-foreground">
              You'll start with a free trial. Upgrade anytime from your dashboard.
            </p>
            <p className="text-xs text-center text-muted-foreground">
              Already have an account?{" "}
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="text-primary hover:underline"
                data-testid="link-signup-to-signin"
              >
                Sign in
              </button>
            </p>
          </CardContent>
        </Card>
        </>
        )}
      </div>
    </div>
  );
}
