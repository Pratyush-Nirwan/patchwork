import {
AlertTriangle,Archive,ArrowRight,BookOpen,Calendar,Columns3,Filter,FolderKanban,HelpCircle,LayoutGrid,Link2,LogOut,
MessageSquare,Moon,Plus,Settings,Shield,Tag,Terminal,Ticket,Trash2,
User,Users
} from "lucide-react";

export function getCommandIcon(name: string) {
  switch (name) {
    case "new":
      return <Plus className="h-3.5 w-3.5 text-[var(--pw-accent)]" />;
    case "open":
      return <Ticket className="h-3.5 w-3.5 text-[var(--pw-accent)]" />;
    case "move":
      return <ArrowRight className="h-3.5 w-3.5 text-[var(--pw-accent)]" />;
    case "assign":
      return <User className="h-3.5 w-3.5 text-[var(--pw-accent)]" />;
    case "priority":
      return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
    case "label":
      return <Tag className="h-3.5 w-3.5 text-[var(--pw-accent)]" />;
    case "due":
      return <Calendar className="h-3.5 w-3.5 text-[var(--pw-accent)]" />;
    case "comment":
      return <MessageSquare className="h-3.5 w-3.5 text-[var(--pw-accent)]" />;
    case "link":
      return <Link2 className="h-3.5 w-3.5 text-[var(--pw-accent)]" />;
    case "archive":
      return <Archive className="h-3.5 w-3.5 text-amber-500" />;
    case "delete":
      return <Trash2 className="h-3.5 w-3.5 text-red-500" />;
    case "go":
      return <FolderKanban className="h-3.5 w-3.5 text-[var(--pw-accent)]" />;
    case "view":
      return <LayoutGrid className="h-3.5 w-3.5 text-[var(--pw-accent)]" />;
    case "filter":
      return <Filter className="h-3.5 w-3.5 text-[var(--pw-accent)]" />;
    case "column":
      return <Columns3 className="h-3.5 w-3.5 text-[var(--pw-accent)]" />;
    case "members":
      return <Users className="h-3.5 w-3.5 text-[var(--pw-accent)]" />;
    case "theme":
      return <Moon className="h-3.5 w-3.5 text-[var(--pw-accent)]" />;
    case "settings":
      return <Settings className="h-3.5 w-3.5 text-[var(--pw-accent)]" />;
    case "system":
      return <Shield className="h-3.5 w-3.5 text-[var(--pw-accent)]" />;
    case "help":
      return <HelpCircle className="h-3.5 w-3.5 text-[var(--pw-accent)]" />;
    case "docs":
      return <BookOpen className="h-3.5 w-3.5 text-[var(--pw-accent)]" />;
    case "logout":
      return <LogOut className="h-3.5 w-3.5 text-red-500" />;
    default:
      return <Terminal className="h-3.5 w-3.5 text-[var(--pw-accent)]" />;
  }
}
