import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";

// GET /api/pages?issue_id=xxx — list pages for an issue ordered by page_number
export async function GET(req: NextRequest) {
  const issueId = req.nextUrl.searchParams.get("issue_id");
  if (!issueId) return NextResponse.json({ error: "issue_id required" }, { status: 400 });

  const { data, error } = await supabase
    .from("pages")
    .select("id, issue_id, page_number, title, created_at")
    .eq("issue_id", issueId)
    .order("page_number", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ pages: data });
}

// POST /api/pages — create page { issue_id, page_number?, title? }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { issue_id, page_number, title } = body as {
      issue_id: string;
      page_number?: number;
      title?: string;
    };
    if (!issue_id) return NextResponse.json({ error: "issue_id required" }, { status: 400 });

    let pageNumber = page_number;
    if (pageNumber == null) {
      const { data: maxData } = await supabase
        .from("pages")
        .select("page_number")
        .eq("issue_id", issue_id)
        .order("page_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      const maxNum = (maxData as { page_number: number } | null)?.page_number ?? 0;
      pageNumber = maxNum + 1;
    }

    const insertAny = (supabase.from("pages") as unknown as {
      insert: (v: unknown) => { select: (s: string) => { single: () => Promise<{ data: unknown; error: { message: string } | null }> } };
    });

    const { data, error } = await insertAny
      .insert({ issue_id, page_number: pageNumber, title: title?.trim() || null })
      .select("id, issue_id, page_number, title, created_at")
      .single();

    if (error || !data) return NextResponse.json({ error: error?.message || "Insert failed" }, { status: 500 });
    return NextResponse.json({ page: data }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
