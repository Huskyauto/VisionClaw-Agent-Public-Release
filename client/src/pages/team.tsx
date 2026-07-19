import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users, UserPlus, Shield, Eye, PenTool, Mail,
  MoreVertical, Trash2, Clock, CheckCircle2
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

interface TeamMember {
  id: number;
  tenantId: number;
  email: string;
  displayName: string | null;
  role: string;
  status: string;
  invitedBy: number | null;
  invitedAt: string;
  joinedAt: string | null;
}

const ROLE_ICONS: Record<string, any> = {
  admin: Shield,
  editor: PenTool,
  viewer: Eye,
};

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-red-500/10 text-red-600 border-red-200 dark:border-red-800",
  editor: "bg-blue-500/10 text-blue-600 border-blue-200 dark:border-blue-800",
  viewer: "bg-gray-500/10 text-gray-600 border-gray-200 dark:border-gray-800",
};

const STATUS_COLORS: Record<string, string> = {
  invited: "bg-amber-500/10 text-amber-600",
  active: "bg-emerald-500/10 text-emerald-600",
  suspended: "bg-red-500/10 text-red-600",
};

export default function TeamPage() {
  const { toast } = useToast();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("viewer");

  const { data: members = [], isLoading } = useQuery<TeamMember[]>({
    queryKey: ["/api/team"],
  });

  const inviteMutation = useMutation({
    mutationFn: async (data: { email: string; displayName: string; role: string }) => {
      const res = await apiRequest("POST", "/api/team", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team"] });
      setInviteOpen(false);
      setEmail("");
      setDisplayName("");
      setRole("viewer");
      toast({ title: "Team member invited" });
    },
    onError: (err: any) => toast({ title: "Failed to invite", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: number; role?: string; status?: string }) => {
      const res = await apiRequest("PATCH", `/api/team/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team"] });
      toast({ title: "Team member updated" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/team/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team"] });
      toast({ title: "Team member removed" });
    },
  });

  const activeCount = members.filter(m => m.status === "active").length;
  const invitedCount = members.filter(m => m.status === "invited").length;

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-team-title">
            <Users className="w-6 h-6 text-primary" />
            Team Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage team members and access roles
          </p>
        </div>
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-invite-member">
              <UserPlus className="w-4 h-4 mr-2" /> Invite Member
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite Team Member</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Email Address</label>
                <Input
                  placeholder="colleague@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  data-testid="input-invite-email"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Display Name</label>
                <Input
                  placeholder="John Doe"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  data-testid="input-invite-name"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Role</label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger data-testid="select-invite-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin — Full platform access</SelectItem>
                    <SelectItem value="editor">Editor — Can create and modify</SelectItem>
                    <SelectItem value="viewer">Viewer — Read-only access</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button
                onClick={() => inviteMutation.mutate({ email, displayName, role })}
                disabled={!email || inviteMutation.isPending}
                data-testid="button-send-invite"
              >
                {inviteMutation.isPending ? "Sending..." : "Send Invitation"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Users className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-total-members">{members.length}</p>
                <p className="text-xs text-muted-foreground">Total Members</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-active-members">{activeCount}</p>
                <p className="text-xs text-muted-foreground">Active</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <Mail className="w-5 h-5 text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-pending-invites">{invitedCount}</p>
                <p className="text-xs text-muted-foreground">Pending Invites</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">Team Members</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <Skeleton className="w-10 h-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          ) : members.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No team members yet</p>
              <p className="text-sm">Invite your first team member to get started</p>
            </div>
          ) : (
            <div className="space-y-2">
              {members.map((member) => {
                const RoleIcon = ROLE_ICONS[member.role] || Eye;
                return (
                  <div
                    key={member.id}
                    className="flex items-center gap-4 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                    data-testid={`row-member-${member.id}`}
                  >
                    <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 text-primary font-bold text-sm">
                      {(member.displayName || member.email).charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">
                          {member.displayName || member.email.split("@")[0]}
                        </span>
                        <Badge variant="outline" className={`text-xs ${ROLE_COLORS[member.role] || ""}`}>
                          <RoleIcon className="w-3 h-3 mr-1" />
                          {member.role}
                        </Badge>
                        <Badge className={`text-xs ${STATUS_COLORS[member.status] || ""}`}>
                          {member.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-muted-foreground">{member.email}</span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {member.joinedAt
                            ? `Joined ${formatDistanceToNow(new Date(member.joinedAt), { addSuffix: true })}`
                            : `Invited ${formatDistanceToNow(new Date(member.invitedAt), { addSuffix: true })}`}
                        </span>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`button-member-menu-${member.id}`}>
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => updateMutation.mutate({ id: member.id, role: "admin" })}>
                          <Shield className="w-4 h-4 mr-2" /> Make Admin
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => updateMutation.mutate({ id: member.id, role: "editor" })}>
                          <PenTool className="w-4 h-4 mr-2" /> Make Editor
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => updateMutation.mutate({ id: member.id, role: "viewer" })}>
                          <Eye className="w-4 h-4 mr-2" /> Make Viewer
                        </DropdownMenuItem>
                        {member.status === "invited" && (
                          <DropdownMenuItem onClick={() => updateMutation.mutate({ id: member.id, status: "active" })}>
                            <CheckCircle2 className="w-4 h-4 mr-2" /> Mark Active
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => deleteMutation.mutate(member.id)}
                        >
                          <Trash2 className="w-4 h-4 mr-2" /> Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}