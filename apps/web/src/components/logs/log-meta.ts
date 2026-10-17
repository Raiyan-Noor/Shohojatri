import {
  Annoyed,
  BookOpen,
  CalendarCheck,
  CircleAlert,
  ClipboardList,
  Ear,
  Eye,
  Footprints,
  Frown,
  Heart,
  Laugh,
  Meh,
  MessageCircle,
  Moon,
  NotebookPen,
  School,
  Shirt,
  Smile,
  Sparkles,
  Star,
  Stethoscope,
  TrendingUp,
  Users,
  Utensils,
  type LucideIcon,
} from "lucide-react";

import type {
  AuthorRole,
  GoalProgress,
  LogDomain,
  LogType,
  LogVisibility,
} from "@/lib/logs/queries";

// Display metadata for timeline entries (COMPANION_SPEC §5.1). Labels live in messages under
// `logs.domains`, `logs.types`, `logs.faces` … with these same keys.

export const DOMAINS: { id: LogDomain; icon: LucideIcon }[] = [
  { id: "communication", icon: MessageCircle },
  { id: "social", icon: Users },
  { id: "behaviour_emotions", icon: Heart },
  { id: "sensory", icon: Ear },
  { id: "daily_living", icon: Shirt },
  { id: "learning", icon: BookOpen },
  { id: "motor", icon: Footprints },
  { id: "sleep", icon: Moon },
  { id: "eating", icon: Utensils },
];

export const TYPE_ICONS: Record<LogType, LucideIcon> = {
  observation: Eye,
  progress: TrendingUp,
  concern: CircleAlert,
  milestone: Star,
  therapy_session: CalendarCheck,
  school_day: School,
  clinical_note: Stethoscope,
  activity_done: Sparkles,
  check_in: ClipboardList,
};

/** What each role may type in, in the order offered (check-ins are written by the app). */
export const TYPES_FOR: Record<AuthorRole, LogType[]> = {
  parent: ["observation", "progress", "milestone", "concern", "activity_done"],
  teacher: ["school_day", "observation", "progress", "milestone", "concern"],
  specialist: ["therapy_session", "clinical_note", "observation", "progress", "concern"],
};

/** The full log form's starting type, and its template prompt (§5.1 "Template prompts"). */
export const DEFAULT_TYPE: Record<AuthorRole, LogType> = {
  parent: "observation",
  teacher: "school_day",
  specialist: "therapy_session",
};

export const VISIBILITIES_FOR: Record<AuthorRole, LogVisibility[]> = {
  parent: ["care_team", "clinical", "private"],
  // A teacher can't read clinical entries, so can't write one either.
  teacher: ["care_team", "private"],
  specialist: ["care_team", "clinical", "private"],
};

export const FACES: { value: number; icon: LucideIcon }[] = [
  { value: 1, icon: Frown },
  { value: 2, icon: Annoyed },
  { value: 3, icon: Meh },
  { value: 4, icon: Smile },
  { value: 5, icon: Laugh },
];

export const GOAL_PROGRESS: GoalProgress[] = ["no_progress", "some", "good", "achieved"];

export const NOTE_ICON = NotebookPen;
