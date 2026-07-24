import { useLocation } from "wouter";
import { SeoHead } from "@/components/seo-head";
import { Button } from "@/components/ui/button";
import { Cpu, ArrowLeft } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { useSiteConfig } from "@/hooks/use-site-config";

export default function TermsPage() {
  const [, navigate] = useLocation();
  const { config } = useSiteConfig();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SeoHead
        title={`Terms of Service — ${config.platformName}`}
        description={`${config.platformName} terms of service. Usage terms, acceptable use policy, subscription billing, and intellectual property rights.`}
        canonical=""
      />
      <nav className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-6 flex items-center justify-between gap-4 h-14">
          <button
            onClick={() => navigate("/landing")}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            data-testid="button-terms-back"
          >
            <ArrowLeft className="w-4 h-4" />
            <Cpu className="w-5 h-5 text-primary" />
            <span className="font-bold text-lg">{config.platformName}</span>
          </button>
          <ThemeToggle />
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold mb-2" data-testid="text-terms-title">Terms of Service</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>

        <div className="prose prose-sm dark:prose-invert max-w-none space-y-6">
          <section>
            <h2 className="text-xl font-semibold mb-3">1. Acceptance of Terms</h2>
            <p className="text-muted-foreground leading-relaxed">
              By accessing or using {config.platformName} ("the Service"), operated by {config.companyLegal} ("we," "us," or "our"), you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the Service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">2. Description of Service</h2>
            <p className="text-muted-foreground leading-relaxed">
              {config.platformName} is an agentic AI platform that provides multi-persona AI assistants, autonomous task execution, memory systems, voice interactions, and related AI-powered tools. The Service is provided on a subscription basis with various tiers offering different levels of access and capabilities.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">3. Account Registration</h2>
            <p className="text-muted-foreground leading-relaxed">
              To use the Service, you must create an account. You agree to provide accurate, current, and complete information during registration and to update such information to keep it accurate. You are responsible for safeguarding your account credentials and for all activities that occur under your account.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">4. Free Trial</h2>
            <p className="text-muted-foreground leading-relaxed">
              We offer a free trial that includes a limited number of conversations. The trial provides access to the full platform experience. No credit card is required for the trial. After your trial conversations are used, you will need to subscribe to a paid plan to continue using the Service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">5. Subscription and Billing</h2>
            <p className="text-muted-foreground leading-relaxed">
              Paid subscriptions are billed monthly through Stripe. You authorize us to charge your payment method on a recurring basis. You may cancel your subscription at any time, and cancellation will take effect at the end of your current billing period. Refunds are handled on a case-by-case basis at our discretion.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">6. Acceptable Use</h2>
            <p className="text-muted-foreground leading-relaxed">You agree not to:</p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1 mt-2">
              <li>Use the Service for any unlawful purpose or in violation of any applicable laws</li>
              <li>Attempt to gain unauthorized access to any part of the Service or its systems</li>
              <li>Use the Service to generate content that is harmful, abusive, threatening, or discriminatory</li>
              <li>Reverse engineer, decompile, or disassemble any part of the Service</li>
              <li>Use automated systems to excessively access the Service beyond normal usage patterns</li>
              <li>Resell, redistribute, or sublicense access to the Service without our written consent</li>
              <li>Upload malicious code, viruses, or any harmful material</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">7. AI-Generated Content</h2>
            <p className="text-muted-foreground leading-relaxed">
              The Service uses artificial intelligence to generate responses and perform tasks. AI-generated content may not always be accurate, complete, or appropriate. You acknowledge that you are responsible for reviewing and verifying any AI-generated content before relying on it. We do not guarantee the accuracy of AI outputs and are not liable for decisions made based on AI-generated content.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">8. Bring Your Own Key (BYOK)</h2>
            <p className="text-muted-foreground leading-relaxed mb-3">
              The Service allows you to connect your own third-party AI provider API keys ("BYOK") to receive enhanced usage limits. When using BYOK:
            </p>
            <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
              <li>Response quality, speed, accuracy, and reliability are determined by your chosen AI provider and model, not by {config.platformName}.</li>
              <li>{config.platformName} provides the agent framework, orchestration layer, tool integrations, memory systems, and infrastructure — but does not control the underlying AI model outputs when BYOK keys are in use.</li>
              <li>You are solely responsible for compliance with your AI provider's terms of service, usage policies, and any associated costs.</li>
              <li>{config.platformName} is not liable for any errors, failures, downtime, data loss, or degraded experience resulting from your third-party AI provider's service.</li>
              <li>We recommend our managed plans for the most optimized and consistent experience, where we curate model routing and quality for every request.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">9. Intellectual Property</h2>
            <p className="text-muted-foreground leading-relaxed">
              You retain ownership of any content you provide to the Service. Content generated by the AI in response to your inputs is licensed to you for your use. The Service itself, including its design, code, and branding, remains our intellectual property.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">10. Data and Privacy</h2>
            <p className="text-muted-foreground leading-relaxed">
              Your use of the Service is also governed by our <button onClick={() => navigate("/privacy")} className="text-primary hover:underline">Privacy Policy</button>. By using the Service, you consent to the collection and use of your information as described in that policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">11. Service Availability</h2>
            <p className="text-muted-foreground leading-relaxed">
              We strive to maintain high availability but do not guarantee uninterrupted access. The Service may be temporarily unavailable due to maintenance, updates, or circumstances beyond our control. We are not liable for any loss or damage resulting from service interruptions.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">12. Limitation of Liability</h2>
            <p className="text-muted-foreground leading-relaxed">
              To the maximum extent permitted by law, the platform operator shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits or revenues, whether incurred directly or indirectly, or any loss of data, use, goodwill, or other intangible losses, resulting from your use of the Service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">13. Termination & Data Retention</h2>
            <p className="text-muted-foreground leading-relaxed mb-3">
              We reserve the right to suspend or terminate your account at any time for violation of these terms or for any reason at our discretion. Upon termination, your right to use the Service ceases immediately.
            </p>
            <p className="text-muted-foreground leading-relaxed mb-3">
              <strong className="text-foreground">Account Deletion by User:</strong> You may request account deletion at any time from the Settings page. Upon requesting deletion, a <strong className="text-foreground">30-day grace period</strong> begins during which:
            </p>
            <ul className="text-muted-foreground leading-relaxed list-disc list-inside space-y-1 mb-3 ml-2">
              <li>Your account will be deactivated (no new activity permitted).</li>
              <li>All your data — including conversations, files, memories, knowledge base entries, API keys, and account settings — will remain stored and available for download during this period.</li>
              <li>You may download your files from the Files page and export your data from Settings at any time before the deletion date.</li>
              <li>You may cancel the deletion and reactivate your account at any time during the grace period.</li>
              <li>A confirmation email will be sent to your registered email address with the scheduled deletion date and instructions for downloading your data.</li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mb-3">
              <strong className="text-foreground">After the 30-day grace period expires:</strong> All data associated with your account will be <strong className="text-foreground">permanently and irreversibly deleted</strong> from our systems. This includes all conversations, messages, uploaded files, AI memories, knowledge base entries, custom tools, API keys, and account credentials. <strong className="text-foreground">We cannot recover any data after permanent deletion.</strong>
            </p>
            <p className="text-muted-foreground leading-relaxed">
              <strong className="text-foreground">Your Responsibility:</strong> It is your sole responsibility to download and back up any files, data, or content you wish to retain before the grace period expires. The platform operator is not liable for any data loss resulting from account deletion, whether requested by you or initiated due to terms violations.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">14. Changes to Terms</h2>
            <p className="text-muted-foreground leading-relaxed">
              We may update these Terms of Service from time to time. We will notify you of material changes by posting the updated terms on this page with a revised date. Your continued use of the Service after changes are posted constitutes your acceptance of the revised terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">15. Governing Law</h2>
            <p className="text-muted-foreground leading-relaxed">
              These Terms shall be governed by and construed in accordance with applicable law, without regard to conflict of law provisions.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">16. Contact</h2>
            <p className="text-muted-foreground leading-relaxed">
              If you have any questions about these Terms of Service, please contact us through the <button onClick={() => navigate("/contact")} className="text-primary hover:underline">contact page</button>.
            </p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-border">
          <Button variant="outline" onClick={() => navigate("/landing")} data-testid="button-terms-back-bottom">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
        </div>
      </div>
    </div>
  );
}
