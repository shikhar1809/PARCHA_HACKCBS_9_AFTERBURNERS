import {
  FileText,
  FlaskConical,
  IdCard,
  Pill,
  ScrollText,
  ShieldCheck,
  Users,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  IdCard,
  FileText,
  Pill,
  ScrollText,
  ShieldCheck,
  UtensilsCrossed,
  Users,
  FlaskConical,
};

/** The picture for one "please bring" item, by the icon name the catalogue gives. */
export function BringIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? FileText;
  return <Icon className={className} strokeWidth={2.2} aria-hidden />;
}
