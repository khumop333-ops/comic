import { NextRequest, NextResponse } from "next/server";
import { supabase, getSupabase } from "@/lib/supabase";
import { pageSchema, parseOrError } from "@/lib/validation";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const issueId = req.nextUrl.searchParams.get("issue_id");
  if (!issueId) return NextResponse.json({ error: "issue_id required" }, { status: 400 });

  const { data, error } = await supabase
    .from("pages")
    .select("id, issue_id, page_number, title, created_at")
    .eq("issue_id", issueId)
    .order("page_number", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const res = NextResponse.json({ pages: data });
  res.headers.set("Cache-Control", "public, s-maxage=30, stale-while-revalidate=300");
  return res;
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = rateLimit(`page:${ip}`, 40, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Rate limited", retryAfterMs: rl.retryAfterMs }, { status: 429 });

  try {
    const body = await req.json();
    const parsed = parseOrError(pageSchema, body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    let pageNumber = parsed.data.page_number;
    if (pageNumber == null) {
      // Use atomic function
      const { data: n, error: nErr } = await (getSupabase().rpc as unknown as (fn: string, params: unknown) => Promise<{ data: number | null; error: { message: string } | null }>)(
        "next_page_number",
        { p_issue_id: parsed.data.issue_id }
      );
      if (nErr || n == null) {
        const { data: maxData } = await supabase.from("pages").select("page_number").eq("issue_id", parsed.data.issue_id).order("page_number", { ascending: false }).limit(1).maybeSingle();
        pageNumber = ((maxData as { page_number: number } | null)?.page_number ?? 0) + 1;
      } else {
        pageNumber = n;
      }
    }

    const insertAny = (getSupabase().from("pages") as unknown as {
      insert: (v: unknown) => { select: (s: string) => { single: () => Promise<{ data: unknown; error: { message: string } | null }> } };
    });

    const { data, error } = await insertAny
      .insert({ issue_id: parsed.data.issue_id, page_number: pageNumber, title: parsed.data.title?.trim() || null })
      .select("id, issue_id, page_number, title, created_at")
      .single();

    if (error || !data) return NextResponse.json({ error: error?.message || "Insert failed" }, { status: 500 });
    return NextResponse.json({ page: data }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const ip = getClientIp(req);
  const rl = rateLimit(`page-del:${ip}`, 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  const { error } = await (getSupabase().from("pages") as unknown as { delete: () => { eq: (c: string, v: unknown) => Promise<{ error: { message: string } | null }> } }).delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
