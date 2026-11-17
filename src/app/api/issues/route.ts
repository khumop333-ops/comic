import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";

export async function GET() {
  const { data, error } = await supabase
    .from("issues")
    .select("id, title, issue_number, description, cover_image_url, created_at")
    .order("issue_number", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ issues: data });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { title, issue_number, description, cover_image_url } = body as {
      title: string;
      issue_number?: number;
      description?: string;
      cover_image_url?: string | null;
    };

    if (!title?.trim()) return NextResponse.json({ error: "title required" }, { status: 400 });

    let issueNumber = issue_number;
    if (issueNumber == null) {
      const { data: maxData } = await supabase
        .from("issues")
        .select("issue_number")
        .order("issue_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      const maxNum = (maxData as { issue_number: number } | null)?.issue_number ?? 0;
      issueNumber = maxNum + 1;
    }

    const insertAny = (supabase.from("issues") as unknown as {
      insert: (v: unknown) => { select: (s: string) => { single: () => Promise<{ data: unknown; error: { message: string } | null }> } };
    });

    const { data, error } = await insertAny
      .insert({
        title: title.trim(),
        issue_number: issueNumber,
        description: description?.trim() || null,
        cover_image_url: cover_image_url || null,
      })
      .select("id, title, issue_number, description, cover_image_url, created_at")
      .single();

    if (error || !data) return NextResponse.json({ error: error?.message || "Insert failed" }, { status: 500 });
    return NextResponse.json({ issue: data }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
