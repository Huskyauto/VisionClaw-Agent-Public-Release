import { useLocation } from "wouter";
import { SeoHead } from "@/components/seo-head";
import { Button } from "@/components/ui/button";
import { Cpu, ArrowLeft } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { useSiteConfig } from "@/hooks/use-site-config";

export default function PrivacyPage() {
  const [, navigate] = useLocation();
  const { config } = useSiteConfig();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SeoHead
        title={`Privacy Policy — ${config.platformName}`}
        description={`${config.platformName} privacy policy. Learn how we collect, use, and protect your data. Essential cookies only, no tracking or advertising.`}
        canonical=""
      />
      <nav className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-6 flex items-center justify-between gap-4 h-14">
          <button
            onClick={() => navigate("/landing")}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            data-testid="button-privacy-back"
          >
            <ArrowLeft className="w-4 h-4" />
            <Cpu className="w-5 h-5 text-primary" />
            <span className="font-bold text-lg">{config.platformName}</span>
          </button>
          <ThemeToggle />
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold mb-2" data-testid="text-privacy-title">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>

        <div className="prose prose-sm dark:prose-invert max-w-none space-y-6">
          <section>
            <h2 className="text-xl font-semibold mb-3">1. Introduction</h2>
            <p className="text-muted-foreground leading-relaxed">
              {config.companyLegal} ("we," "us," or "our") operates {config.platformName} ("the Service"). This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our Service. Please read this policy carefully.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">2. Information We Collect</h2>
            <h3 className="text-lg font-medium mt-4 mb-2">Account Information</h3>
            <p className="text-muted-foreground leading-relaxed">
              When you create an account, we collect your name, email address, and authentication credentials. If you sign in through a third-party provider (Google, Apple, GitHub via Replit), we receive your name, email, and profile information from that provider.
            </p>
            <h3 className="text-lg font-medium mt-4 mb-2">Usage Data</h3>
            <p className="text-muted-foreground leading-relaxed">
              We collect information about how you interact with the Service, including conversation content, tool usage, feature usage patterns, and session duration. This data is used to provide and improve the Service.
            </p>
            <h3 className="text-lg font-medium mt-4 mb-2">AI Interaction Data</h3>
            <p className="text-muted-foreground leading-relaxed">
              Messages you send to and receive from AI agents are stored to maintain conversation history, enable memory features, and improve the Service. This includes text, voice transcriptions, and any files you upload.
            </p>
            <h3 className="text-lg font-medium mt-4 mb-2">Payment Information</h3>
            <p className="text-muted-foreground leading-relaxed">
              Payment processing is handled by Stripe. We do not store your complete credit card information. Stripe may collect and store your payment details in accordance with their own privacy policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">3. How We Use Your Information</h2>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1 mt-2">
              <li>To provide, maintain, and improve the Service</li>
              <li>To process your transactions and manage your subscription</li>
              <li>To maintain conversation history and AI memory features</li>
              <li>To send you service-related communications</li>
              <li>To monitor usage patterns and enforce usage limits</li>
              <li>To detect and prevent fraud, abuse, and security issues</li>
              <li>To comply with legal obligations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">4. AI Processing and Third-Party Providers</h2>
            <p className="text-muted-foreground leading-relaxed">
              To provide AI capabilities, your messages may be processed by third-party AI providers including OpenAI, Anthropic, Google, and xAI. These providers process your data according to their respective privacy policies and data processing agreements. We select providers that offer appropriate data protection standards. Your conversation data is sent to these providers for processing and is not used to train their models outside of what their standard policies allow.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">5. Data Storage and Security</h2>
            <p className="text-muted-foreground leading-relaxed">
              Your data is stored in secure PostgreSQL databases hosted on Replit's infrastructure. We implement industry-standard security measures including encrypted connections, secure authentication (PBKDF2-SHA512 password hashing), and access controls. However, no method of transmission over the Internet is 100% secure, and we cannot guarantee absolute security.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">6. Multi-Tenant Isolation</h2>
            <p className="text-muted-foreground leading-relaxed">
              The Service operates as a multi-tenant platform. Your data is logically isolated from other users' data through tenant-based access controls. Each user can only access their own conversations, memories, and settings.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">7. Data Retention</h2>
            <p className="text-muted-foreground leading-relaxed">
              We retain your data for as long as your account is active or as needed to provide the Service. Conversation history, memories, and other user-generated content are retained until you delete them or close your account. Upon account deletion, we will delete your personal data within 30 days, except where we are required to retain it for legal or legitimate business purposes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">8. Your Rights</h2>
            <p className="text-muted-foreground leading-relaxed">Depending on your location, you may have the following rights:</p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1 mt-2">
              <li><strong>Access:</strong> Request a copy of your personal data</li>
              <li><strong>Correction:</strong> Request correction of inaccurate data</li>
              <li><strong>Deletion:</strong> Request deletion of your personal data</li>
              <li><strong>Export:</strong> Request a machine-readable copy of your data</li>
              <li><strong>Opt-out:</strong> Opt out of certain data processing activities</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mt-2">
              To exercise any of these rights, contact us through the <button onClick={() => navigate("/contact")} className="text-primary hover:underline">contact page</button>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">9. Cookies and Tracking</h2>
            <p className="text-muted-foreground leading-relaxed">
              We use session cookies to maintain your authentication state. We do not use third-party tracking cookies or advertising trackers. Essential cookies are required for the Service to function properly.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">10. Children's Privacy</h2>
            <p className="text-muted-foreground leading-relaxed">
              The Service is not intended for children under 13 years of age. We do not knowingly collect personal information from children under 13. If we learn that we have collected information from a child under 13, we will delete that information promptly.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">11. Changes to This Policy</h2>
            <p className="text-muted-foreground leading-relaxed">
              We may update this Privacy Policy from time to time. We will notify you of material changes by posting the updated policy on this page with a revised date. Your continued use of the Service after changes are posted constitutes your acceptance of the revised policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">12. Contact Us</h2>
            <p className="text-muted-foreground leading-relaxed">
              If you have questions about this Privacy Policy or our data practices, please contact us at:
            </p>
            <div className="mt-2 text-muted-foreground">
              <p>Visit our <button onClick={() => navigate("/contact")} className="text-primary hover:underline">contact page</button> to reach us.</p>
            </div>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-border">
          <Button variant="outline" onClick={() => navigate("/landing")} data-testid="button-privacy-back-bottom">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
        </div>
      </div>
    </div>
  );
}
