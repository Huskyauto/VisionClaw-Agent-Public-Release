import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, authFetch } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Search, Download, Upload, Loader2, Store, Grid, MessageSquare, Code, BarChart3, Zap, Shield, DollarSign, Briefcase, Brain, Megaphone, FileText, Server, Share2, AlertTriangle, Sparkles } from "lucide-react";

interface SkillTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  promptContent: string;
  author: string;
  version: string;
  downloads: number;
  tags: string[];
}

interface Category {
  id: string;
  name: string;
  icon: string;
}

const ICON_MAP: Record<string, any> = {
  Mail: MessageSquare, Code, BarChart3, FileText, Search, Shield, Share2, DollarSign, Server,
  AlertTriangle, Sparkles, Brain, Zap, Megaphone, Grid, Store, Briefcase,
};

export default function SkillsMarketplacePage() {
  const { toast } = useToast();
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [importJson, setImportJson] = useState("");
  const [showImport, setShowImport] = useState(false);

  const { data: templates = [], isLoading } = useQuery<SkillTemplate[]>({
    queryKey: ["/api/marketplace/templates", selectedCategory, searchQuery],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedCategory !== "all") params.set("category", selectedCategory);
      if (searchQuery) params.set("search", searchQuery);
      const res = await authFetch(`/api/marketplace/templates?${params}`);
      if (!res.ok) throw new Error("Failed to fetch templates");
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["/api/marketplace/categories"],
  });

  const installMutation = useMutation({
    mutationFn: (templateId: string) => apiRequest("POST", "/api/marketplace/install", { templateId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/skills"] });
      toast({ title: "Skill installed!", description: "It's now available in your Skills panel." });
    },
    onError: (err: any) => toast({ title: "Install failed", description: err.message, variant: "destructive" }),
  });

  const importMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/marketplace/import", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/skills"] });
      toast({ title: "Skill imported!" });
      setImportJson("");
      setShowImport(false);
    },
    onError: (err: any) => toast({ title: "Import failed", description: err.message, variant: "destructive" }),
  });

  const handleImport = () => {
    try {
      const data = JSON.parse(importJson);
      importMutation.mutate(data);
    } catch {
      toast({ title: "Invalid JSON", variant: "destructive" });
    }
  };

  if (isLoading) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="h-full overflow-y-auto container mx-auto p-6 max-w-5xl space-y-6" data-testid="skills-marketplace-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Store className="h-7 w-7 text-primary" /> Skills Marketplace
          </h1>
          <p className="text-muted-foreground">Browse, install, and share agent skills to extend VisionClaw's capabilities.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowImport(!showImport)} data-testid="button-import">
          <Upload className="mr-2 h-4 w-4" /> Import Skill
        </Button>
      </div>

      {showImport && (
        <Card data-testid="card-import">
          <CardHeader><CardTitle>Import Skill</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <textarea
              className="w-full h-32 p-3 rounded border bg-background text-sm font-mono resize-none"
              placeholder="Paste exported skill JSON here..."
              value={importJson}
              onChange={e => setImportJson(e.target.value)}
              data-testid="textarea-import"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleImport} disabled={!importJson || importMutation.isPending} data-testid="button-import-submit">
                {importMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />} Import
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowImport(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search skills..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {categories.map(cat => {
          const CatIcon = ICON_MAP[cat.icon] || Grid;
          return (
            <Button
              key={cat.id}
              variant={selectedCategory === cat.id ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedCategory(cat.id)}
              data-testid={`category-${cat.id}`}
            >
              <CatIcon className="mr-1 h-3 w-3" /> {cat.name}
            </Button>
          );
        })}
      </div>

      {templates.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">
          <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No skills match your search. Try a different category or keyword.</p>
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map(template => {
            const TemplateIcon = ICON_MAP[template.icon] || Zap;
            return (
              <Card key={template.id} className="flex flex-col" data-testid={`template-${template.id}`}>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <TemplateIcon className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1">
                      <CardTitle className="text-base">{template.name}</CardTitle>
                      <div className="flex items-center gap-1 mt-1">
                        <Badge variant="outline" className="text-xs">{template.category}</Badge>
                        <span className="text-xs text-muted-foreground">v{template.version}</span>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col">
                  <p className="text-sm text-muted-foreground flex-1">{template.description}</p>
                  <div className="flex flex-wrap gap-1 mt-3 mb-3">
                    {template.tags.map(tag => (
                      <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                    ))}
                  </div>
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => installMutation.mutate(template.id)}
                    disabled={installMutation.isPending}
                    data-testid={`button-install-${template.id}`}
                  >
                    <Download className="mr-2 h-4 w-4" /> Install
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card data-testid="card-sharing-info">
        <CardHeader><CardTitle>Sharing Skills</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>Export any installed skill from the Skills page to get a JSON file you can share with others.</p>
          <p>Import shared skills using the "Import Skill" button above — paste the JSON and it's added to your agent instantly.</p>
          <p className="text-xs">Format: <code>visionclaw-skill-v1</code> — includes name, description, category, and prompt content.</p>
        </CardContent>
      </Card>
    </div>
  );
}
