import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useState } from "react";
import { useLocation } from "wouter";
import {
  Brain, FolderOpen, Mic, Lightbulb, BookOpen,
  Sparkles, MessageSquare, Repeat, CheckCircle2,
  ArrowRight, ChevronDown, ChevronUp, PenTool,
  Zap, Target, FileText, Star
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface Skill {
  id: number;
  name: string;
  enabled: boolean;
}

const steps = [
  {
    step: 1,
    title: "Turn on Memory",
    subtitle: "Brand recall across every conversation",
    what: "Your agent remembers your brand voice, audience, and preferences across every conversation — automatically.",
    how: [
      "Open any chat and tell your agent about your brand, audience, and tone",
      "The Memory Palace stores it permanently with wing/room organization",
      "Every future conversation loads your brand context automatically",
    ],
    bestPractice: "Update whenever your positioning or voice changes. Include examples of good AND bad copy so your agent knows what to avoid.",
    icon: Brain,
    color: "from-violet-500 to-purple-600",
    vcFeature: "Memory Palace — 4-layer persistent memory system",
    link: "/memory",
    linkLabel: "Open Memory",
  },
  {
    step: 2,
    title: "Create a Project",
    subtitle: "Keep all your content in one place",
    what: "Keep all your briefs, brand docs, past content, and reference files in one place so your agent always has context.",
    how: [
      "Go to Projects and create a new content project",
      "Upload your brand guide, top-performing posts, and reference docs",
      "All chats inside the project share that context automatically",
    ],
    bestPractice: "One project per client or content stream. Keep it clean — too much in there and the agent loses the plot.",
    icon: FolderOpen,
    color: "from-blue-500 to-cyan-500",
    vcFeature: "Project Brain System — auto-continuity with Drive folders",
    link: "/projects",
    linkLabel: "Open Projects",
  },
  {
    step: 3,
    title: "Upload Your Tone of Voice",
    subtitle: "Sound like you, not like AI",
    what: "Give your agent your actual voice so outputs need less editing before they sound like you.",
    how: [
      "Tell your agent your tone preferences in a content project chat",
      "Include examples of good copy AND bad copy — show what to avoid",
      "The agent saves it as a Personality File for persistent reference",
    ],
    bestPractice: "Include sentence length preferences, words you never use, emoji policy, and your signature phrases.",
    icon: Mic,
    color: "from-emerald-500 to-green-500",
    vcFeature: "Personality Files — persistent tone & voice documents",
    link: "/personality-files",
    linkLabel: "Open Personality Files",
  },
  {
    step: 4,
    title: "Strategy Before Writing",
    subtitle: "Think first, write second",
    what: "Your agent works through the brief before writing, so you get stronger strategy and fewer rewrites.",
    how: [
      "When you ask for content, the agent shows its strategy first",
      "It identifies the goal, audience, hook, and CTA before drafting",
      "You approve or redirect the strategy — then it writes",
    ],
    bestPractice: "Use for positioning work, brief writing, and hook development. Let the agent show its reasoning before the final output.",
    icon: Lightbulb,
    color: "from-amber-500 to-yellow-500",
    vcFeature: "Built into the Content Writing System skill — automatic",
    link: null,
    linkLabel: null,
  },
  {
    step: 5,
    title: "Build a Prompt Library",
    subtitle: "Never start from scratch",
    what: "Save your best prompts as reusable templates so you can paste, adapt, and go instead of rewriting every time.",
    how: [
      "When you create a good content prompt, tell your agent to save it as a template",
      "Templates are stored in memory labeled by task: hooks, briefs, carousels, emails",
      "Next time, the agent checks for existing templates before starting fresh",
    ],
    bestPractice: "Don't rewrite from scratch every time. Steal from yourself — that's literally what the library is for.",
    icon: BookOpen,
    color: "from-pink-500 to-rose-500",
    vcFeature: "Memory Palace with wing='content' room='prompt-library'",
    link: "/memory",
    linkLabel: "View Prompt Library",
  },
  {
    step: 6,
    title: "Prompt for Ideas",
    subtitle: "Structured ideation that works",
    what: "Structured prompts that give your agent enough context to generate good, useful content ideas — not generic filler.",
    how: [
      "Use the structure: Role, Task, Context, Output",
      "Include your ICP, content goal, and desired format in every ideation prompt",
      "Ask for 3 options, then have the agent critique and improve the best one",
    ],
    bestPractice: "The more specific the input, the stronger the idea. Vague prompts get vague content.",
    icon: Sparkles,
    color: "from-indigo-500 to-blue-500",
    vcFeature: "Structured ideation built into skill — 3 options + critique",
    link: null,
    linkLabel: null,
  },
  {
    step: 7,
    title: "Critique Before You Write",
    subtitle: "Flag problems before drafting",
    what: "Ask your agent to flag weak angles, vague framing, and hook issues before it writes — fix the brief first, then draft.",
    how: [
      'Say: "Before drafting, identify any weak angles, vague framing, or hook issues"',
      "Give the agent your brief and ask for a critique first",
      "Use the feedback to tighten the brief, then ask for the draft",
    ],
    bestPractice: "Take the feedback, fix the brief, then ask for the draft. Order matters.",
    icon: Target,
    color: "from-red-500 to-orange-500",
    vcFeature: "Auto-critique step built into every content workflow",
    link: null,
    linkLabel: null,
  },
  {
    step: 8,
    title: "Repurpose Your Content",
    subtitle: "One idea, many formats",
    what: "Turn one strong post into loads of different formats without starting over — carousel, thread, email, video script.",
    how: [
      "Give the agent one of your top-performing posts",
      "Ask for 3 format variations: carousel, short text, story-led",
      "Tell it your target audience and their pain points for each version",
    ],
    bestPractice: "Same idea, different format. Don't drift from the original point or the whole thing falls apart.",
    icon: Repeat,
    color: "from-teal-500 to-cyan-500",
    vcFeature: "Multi-format repurposing with audience-specific adaptation",
    link: null,
    linkLabel: null,
  },
  {
    step: 9,
    title: "Review Before You Post",
    subtitle: "Score every piece before it goes live",
    what: "A standing review that checks every post against your ICP, hook quality, and CTA before it goes live.",
    how: [
      'Say: "Review this before I post" and paste your draft',
      "The agent scores Hook, Value, CTA, Voice, and ICP Fit (1-10 each)",
      "Any score below 7 gets a specific fix suggestion",
    ],
    bestPractice: "Checks your post before it goes live: Hook, Value, CTA. If one's off, it shows.",
    icon: CheckCircle2,
    color: "from-fuchsia-500 to-pink-500",
    vcFeature: "5-dimension scoring with auto-fix suggestions",
    link: null,
    linkLabel: null,
  },
];

const quickCommands = [
  { command: '"Setup my content system"', action: "Walks through Steps 1, 2, 3, and 5", icon: Zap },
  { command: '"Write a post about [topic]"', action: "Strategy → Ideation → Critique → Draft → Review", icon: PenTool },
  { command: '"Repurpose this"', action: "Turns one piece into 3 different formats", icon: Repeat },
  { command: '"Review this before I post"', action: "Scores Hook, Value, CTA, Voice, ICP Fit", icon: CheckCircle2 },
  { command: '"Save this as a template"', action: "Adds to your reusable prompt library", icon: BookOpen },
  { command: '"What\'s my brand voice?"', action: "Retrieves your tone of voice from memory", icon: Brain },
];

export default function ContentWritingPage() {
  const [, navigate] = useLocation();
  const [expandedStep, setExpandedStep] = useState<number | null>(0);
  const [showAllSteps, setShowAllSteps] = useState(false);

  const { data: skillData } = useQuery<Skill[]>({
    queryKey: ["/api/skills"],
  });

  const contentSkill = skillData?.find(s => s.name === "Content Writing System");

  const handleStartWriting = () => {
    navigate("/chat");
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
              <PenTool className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-foreground" data-testid="text-page-title">Content Writing System</h1>
              <p className="text-sm text-muted-foreground">9-step framework to turn your agent into a content writing partner</p>
            </div>
          </div>

          <div className="flex items-center gap-3 mt-4">
            <Button
              onClick={handleStartWriting}
              className="bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 text-white"
              data-testid="button-start-writing"
            >
              <MessageSquare className="w-4 h-4 mr-2" />
              Start Writing with This Skill
            </Button>
            {contentSkill && (
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                contentSkill.enabled
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                  : "bg-muted text-muted-foreground border border-border"
              }`} data-testid="badge-skill-status">
                <span className={`w-1.5 h-1.5 rounded-full ${contentSkill.enabled ? "bg-emerald-500" : "bg-muted-foreground"}`} />
                {contentSkill.enabled ? "Skill Active" : "Skill Disabled"}
              </span>
            )}
          </div>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
          {quickCommands.map((cmd, i) => (
            <motion.button
              key={i}
              type="button"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="bg-card border border-border rounded-xl p-4 hover:border-primary/30 transition-colors cursor-pointer group text-left"
              onClick={handleStartWriting}
              data-testid={`card-quick-command-${i}`}
            >
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <cmd.icon className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">{cmd.command}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{cmd.action}</p>
                </div>
              </div>
            </motion.button>
          ))}
        </div>

        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">The 9 Steps</h2>
          <button
            onClick={() => setShowAllSteps(!showAllSteps)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            data-testid="button-toggle-all-steps"
          >
            {showAllSteps ? "Collapse All" : "Expand All"}
            {showAllSteps ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>

        <div className="space-y-3">
          {steps.map((step, index) => {
            const isExpanded = showAllSteps || expandedStep === index;
            return (
              <motion.div
                key={step.step}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
                className="bg-card border border-border rounded-xl overflow-hidden hover:border-primary/20 transition-colors"
                data-testid={`step-card-${step.step}`}
              >
                <button
                  className="w-full flex items-center gap-4 p-4 text-left"
                  onClick={() => setExpandedStep(isExpanded && !showAllSteps ? null : index)}
                  data-testid={`button-expand-step-${step.step}`}
                >
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${step.color} flex items-center justify-center flex-shrink-0`}>
                    <step.icon className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-muted-foreground">STEP {step.step}</span>
                    </div>
                    <h3 className="font-semibold text-foreground text-sm">{step.title}</h3>
                    <p className="text-xs text-muted-foreground">{step.subtitle}</p>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                </button>

                {isExpanded && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="px-4 pb-4 border-t border-border pt-3"
                  >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs font-semibold text-primary mb-1.5">What it does</p>
                        <p className="text-sm text-muted-foreground leading-relaxed">{step.what}</p>

                        <p className="text-xs font-semibold text-primary mt-3 mb-1.5">How to use it</p>
                        <ul className="space-y-1">
                          {step.how.map((item, i) => (
                            <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                              <span className="text-primary mt-0.5 text-xs">{i + 1}.</span>
                              <span>{item}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div>
                        <div className="bg-primary/5 border border-primary/10 rounded-lg p-3 mb-3">
                          <p className="text-xs font-semibold text-primary mb-1 flex items-center gap-1">
                            <Star className="w-3 h-3" /> Best Practice
                          </p>
                          <p className="text-sm text-muted-foreground">{step.bestPractice}</p>
                        </div>

                        <div className="bg-muted/50 rounded-lg p-3">
                          <p className="text-xs font-semibold text-foreground mb-1">VisionClaw Feature</p>
                          <p className="text-sm text-muted-foreground">{step.vcFeature}</p>
                          {step.link && (
                            <a
                              href={step.link}
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate(step.link!); }}
                              className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 mt-2 font-medium"
                              data-testid={`link-step-${step.step}-feature`}
                            >
                              {step.linkLabel} <ArrowRight className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            );
          })}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mt-8 bg-gradient-to-br from-violet-500/10 to-purple-500/10 border border-violet-500/20 rounded-xl p-6 text-center"
        >
          <PenTool className="w-8 h-8 text-primary mx-auto mb-3" />
          <h3 className="text-lg font-bold text-foreground mb-2">Ready to Write?</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            Open a new chat and say "setup my content system" to get started, or just ask your agent to write something — the skill handles the rest.
          </p>
          <Button
            onClick={handleStartWriting}
            size="lg"
            className="bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 text-white"
            data-testid="button-start-writing-bottom"
          >
            <MessageSquare className="w-4 h-4 mr-2" />
            Open Chat & Start Writing
          </Button>
        </motion.div>
      </div>
    </div>
  );
}