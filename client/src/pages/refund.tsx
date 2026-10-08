import { useLocation } from "wouter";
import { SeoHead } from "@/components/seo-head";
import { Button } from "@/components/ui/button";
import { Cpu, ArrowLeft } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { useSiteConfig } from "@/hooks/use-site-config";

export default function RefundPage() {
  const [, navigate] = useLocation();
  const { config } = useSiteConfig();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SeoHead
        title={`Refund Policy — ${config.platformName}`}
        description={`${config.platformName} refund policy. 30-day money-back guarantee on all paid plans. Fair, transparent refund process.`}
        canonical=""
      />
      <nav className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-6 flex items-center justify-between gap-4 h-14">
          <button
            onClick={() => navigate("/landing")}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            data-testid="button-refund-back"
          >
            <ArrowLeft className="w-4 h-4" />
            <Cpu className="w-5 h-5 text-primary" />
            <span className="font-bold text-lg">{config.platformName}</span>
          </button>
          <ThemeToggle />
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold mb-2" data-testid="text-refund-title">Refund Policy</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>

        <div className="prose prose-sm dark:prose-invert max-w-none space-y-6">
          <section>
            <h2 className="text-xl font-semibold mb-3">1. Subscription Refunds</h2>
            <p className="text-muted-foreground leading-relaxed">
              {config.companyLegal} ("we," "us," or "our") wants you to be satisfied with {config.platformName}. If you are not satisfied with your subscription, the following refund policy applies:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-2 mt-3">
              <li><strong>Within 7 days of purchase:</strong> Full refund available for any reason. Simply contact us and we will process the refund within 5-10 business days.</li>
              <li><strong>After 7 days:</strong> Refunds are evaluated on a case-by-case basis. We may issue a prorated refund for the unused portion of your subscription period.</li>
              <li><strong>Annual plans:</strong> Full refund within 14 days of purchase. After 14 days, prorated refund for remaining full months.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">2. How to Request a Refund</h2>
            <p className="text-muted-foreground leading-relaxed">To request a refund, please contact us through one of the following methods:</p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1 mt-3">
              <li>Contact form: <a href="/contact" className="text-primary hover:underline">Contact page</a></li>
            </ul>
            <p className="text-muted-foreground leading-relaxed mt-3">
              Please include your account email address and the reason for your refund request. We aim to respond to all refund requests within 2 business days.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">3. Cancellation</h2>
            <p className="text-muted-foreground leading-relaxed">
              You may cancel your subscription at any time through your account billing settings or by contacting us. When you cancel:
            </p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1 mt-3">
              <li>Your subscription will remain active until the end of the current billing period.</li>
              <li>You will not be charged for the next billing cycle.</li>
              <li>Your data will be retained for 30 days after cancellation, after which it will be permanently deleted.</li>
              <li>You can reactivate your subscription at any time during the 30-day retention period.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">4. Non-Refundable Items</h2>
            <p className="text-muted-foreground leading-relaxed">The following are not eligible for refunds:</p>
            <ul className="list-disc pl-6 text-muted-foreground space-y-1 mt-3">
              <li>Pay-per-use charges for AI model usage that have already been consumed</li>
              <li>Add-on services that have already been delivered (e.g., custom integration setup)</li>
              <li>Accounts that have been suspended for Terms of Service violations</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">5. Service Outages</h2>
            <p className="text-muted-foreground leading-relaxed">
              If {config.platformName} experiences significant downtime (more than 24 continuous hours) that prevents you from using the Service, we will provide a prorated credit or refund for the affected period upon request.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">6. Payment Processing</h2>
            <p className="text-muted-foreground leading-relaxed">
              All payments are processed through Stripe. Refunds will be returned to the original payment method. Please allow 5-10 business days for the refund to appear on your statement. Refunds for international payments may take longer depending on your bank.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">7. Disputes</h2>
            <p className="text-muted-foreground leading-relaxed">
              We encourage you to contact us directly before initiating a payment dispute with your bank or credit card company. We are committed to resolving issues quickly and fairly. Filing a chargeback without first contacting us may result in account suspension.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">8. Contact Us</h2>
            <p className="text-muted-foreground leading-relaxed">
              For any billing or refund questions, please reach out to:
            </p>
            <div className="mt-2 text-muted-foreground">
              <p>Visit our <a href="/contact" className="text-primary hover:underline">contact page</a> to reach us.</p>
            </div>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-border">
          <Button variant="outline" onClick={() => navigate("/landing")} data-testid="button-refund-back-bottom">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
        </div>
      </div>
    </div>
  );
}
