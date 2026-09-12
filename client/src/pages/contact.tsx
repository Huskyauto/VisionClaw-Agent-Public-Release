import { useState } from "react";
import { useLocation } from "wouter";
import { SeoHead } from "@/components/seo-head";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Cpu, ArrowLeft, Mail, MapPin, Clock, Send, CheckCircle } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

import { useToast } from "@/hooks/use-toast";
import { useSiteConfig } from "@/hooks/use-site-config";

export default function ContactPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { config } = useSiteConfig();
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", subject: "general", message: "" });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.message) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/public/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Something went wrong" }));
        toast({ title: "Error", description: data.error || "Failed to send message", variant: "destructive" });
        return;
      }
      setSubmitted(true);
    } catch {
      toast({ title: "Error", description: "Network error. Please check your connection and try again.", variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SeoHead
        title={`Contact Us — ${config.platformName}`}
        description={`Get in touch with the ${config.platformName} team. Enterprise inquiries, support, and partnership opportunities.`}
        canonical=""
      />
      <nav className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-6 flex items-center justify-between gap-4 h-14">
          <button
            onClick={() => navigate("/landing")}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            data-testid="button-contact-back"
          >
            <ArrowLeft className="w-4 h-4" />
            <Cpu className="w-5 h-5 text-primary" />
            <span className="font-bold text-lg">{config.platformName}</span>
          </button>
          <ThemeToggle />
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold mb-2" data-testid="text-contact-title">Contact Us</h1>
        <p className="text-muted-foreground mb-10">Have a question, need support, or want to discuss partnerships? We'd love to hear from you.</p>

        <div className="grid md:grid-cols-3 gap-8">
          <div className="md:col-span-2">
            {submitted ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
                  <h2 className="text-xl font-semibold mb-2" data-testid="text-contact-success">Message Received</h2>
                  <p className="text-muted-foreground mb-6">Thank you for reaching out. We typically respond within 24 hours.</p>
                  <Button variant="outline" onClick={() => { setSubmitted(false); setForm({ name: "", email: "", subject: "general", message: "" }); }} data-testid="button-send-another">
                    Send Another Message
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Send a Message</CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="name">Name *</Label>
                        <Input
                          id="name"
                          value={form.name}
                          onChange={(e) => setForm({ ...form, name: e.target.value })}
                          placeholder="Your name"
                          data-testid="input-contact-name"
                        />
                      </div>
                      <div>
                        <Label htmlFor="email">Email *</Label>
                        <Input
                          id="email"
                          type="email"
                          value={form.email}
                          onChange={(e) => setForm({ ...form, email: e.target.value })}
                          placeholder="you@example.com"
                          data-testid="input-contact-email"
                        />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="subject">Subject</Label>
                      <Select value={form.subject} onValueChange={(v) => setForm({ ...form, subject: v })}>
                        <SelectTrigger data-testid="select-contact-subject">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="general">General Inquiry</SelectItem>
                          <SelectItem value="support">Technical Support</SelectItem>
                          <SelectItem value="billing">Billing Question</SelectItem>
                          <SelectItem value="partnership">Partnership / Investment</SelectItem>
                          <SelectItem value="enterprise">Enterprise Plan</SelectItem>
                          <SelectItem value="bug">Bug Report</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="message">Message *</Label>
                      <Textarea
                        id="message"
                        value={form.message}
                        onChange={(e) => setForm({ ...form, message: e.target.value })}
                        placeholder="Tell us how we can help..."
                        rows={6}
                        data-testid="input-contact-message"
                      />
                    </div>
                    <Button type="submit" disabled={sending} className="w-full sm:w-auto" data-testid="button-contact-submit">
                      {sending ? "Sending..." : <>
                        <Send className="w-4 h-4 mr-2" />
                        Send Message
                      </>}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-4">
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-3 mb-3">
                  <Mail className="w-5 h-5 text-primary" />
                  <h3 className="font-semibold">Email</h3>
                </div>
                <span className="text-sm text-muted-foreground" data-testid="link-contact-email">Use the form to reach us</span>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-3 mb-3">
                  <MapPin className="w-5 h-5 text-primary" />
                  <h3 className="font-semibold">Location</h3>
                </div>
                <p className="text-sm text-muted-foreground">{config.platformName} Platform</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-3 mb-3">
                  <Clock className="w-5 h-5 text-primary" />
                  <h3 className="font-semibold">Response Time</h3>
                </div>
                <p className="text-sm text-muted-foreground">We typically respond within 24 hours during business days.</p>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-border flex gap-3 flex-wrap">
          <Button variant="outline" onClick={() => navigate("/landing")} data-testid="button-contact-back-bottom">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
          <Button variant="outline" onClick={() => navigate("/store")} data-testid="button-contact-store">
            Shop Bob's Store
          </Button>
        </div>
      </div>

      <footer className="border-t border-border py-8 px-6 mt-8">
        <div className="max-w-4xl mx-auto flex flex-wrap items-center justify-between gap-4 text-sm text-muted-foreground">
          <span data-testid="text-contact-footer-copyright">&copy; {new Date().getFullYear()} {config.platformName}. All rights reserved.</span>
          <div className="flex items-center gap-4 flex-wrap">
            <button onClick={() => navigate("/landing")} className="hover:text-foreground transition-colors" data-testid="link-contact-footer-home">Home</button>
            <button onClick={() => navigate("/store")} className="hover:text-foreground transition-colors" data-testid="link-contact-footer-store">Shop</button>
            <button onClick={() => navigate("/about")} className="hover:text-foreground transition-colors" data-testid="link-contact-footer-about">About</button>
          </div>
        </div>
      </footer>
    </div>
  );
}
