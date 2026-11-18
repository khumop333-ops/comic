// Minimal typed helpers — replace with `supabase gen types` output when you link project
export type Issue = {
  id: string;
  title: string;
  issue_number: number;
  description: string | null;
  cover_image_url: string | null;
  user_id: string | null;
  created_at: string;
};

export type Page = {
  id: string;
  issue_id: string;
  page_number: number;
  title: string | null;
  user_id: string | null;
  created_at: string;
};

export type IssuePanel = {
  id: string;
  issue_id: string;
  page_id: string;
  panel_index: number;
  prompt: string;
  image_url: string | null;
  status: "pending" | "completed" | "failed";
  environment_id: string | null;
  user_id: string | null;
  error_message: string | null;
  created_at: string;
};

export type Character = {
  id: string;
  name: string;
  description: string | null;
  reference_image_url: string;
  user_id: string | null;
  created_at: string;
};

export type Environment = {
  id: string;
  name: string;
  description: string | null;
  reference_image_url: string;
  user_id: string | null;
  created_at: string;
};
