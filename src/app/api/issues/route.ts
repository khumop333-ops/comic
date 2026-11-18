import { NextRequest, NextResponse } from "next/server";
import { supabase, getSupabase } from "@/lib/supabase";
import { issueSchema, parseOrError } from "@/lib/validation";
import { rateLimit, getClientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0"), 0);

  const { data, error } = await supabase
    .from("issues")
    .select("id, title, issue_number, description, cover_image_url, created_at")
    .order("issue_number", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const res = NextResponse.json({ issues: data, limit, offset });
  res.headers.set("Cache-Control", "public, s-maxage=30, stale-while-revalidate=300");
  return res;
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = rateLimit(`issue:${ip}`, 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Rate limited", retryAfterMs: rl.retryAfterMs }, { status: 429 });

  try {
    const body = await req.json();
    const parsed = parseOrError(issueSchema, body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    let issueNumber = parsed.data.issue_number;
    // Use atomic DB function if no explicit number
    if (issueNumber == null) {
      const { data: n, error: nErr } = await (getSupabase().rpc as unknown as (fn: string) => Promise<{ data: number | null; error: { message: string } | null }>)("next_issue_number");
      if (nErr) {
        // fallback to max+1
        const { data: maxData } = await supabase.from("issues").select("issue_number").order("issue_number", { ascending: false }).limit(1).maybeSingle();
        issueNumber = ((maxData as { issue_number: number } | null)?.issue_number ?? 0) + 1;
      } else {
        issueNumber = n ?? 1;
      }
    }

    const insertAny = (getSupabase().from("issues") as unknown as {
      insert: (v: unknown) => { select: (s: string) => { single: () => Promise<{ data: unknown; error: { message: string } | null }> } };
    });

    const { data, error } = await insertAny
      .insert({
        title: parsed.data.title.trim(),
        issue_number: issueNumber,
        description: parsed.data.description?.trim() || null,
        cover_image_url: parsed.data.cover_image_url || null,
      })
      .select("id, title, issue_number, description, cover_image_url, created_at")
      .single();

    if (error || !data) return NextResponse.json({ error: error?.message || "Insert failed" }, { status: 500 });
    return NextResponse.json({ issue: data }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const ip = getClientIp(req);
  const rl = rateLimit(`issue-del:${ip}`, 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  const { error } = await (getSupabase().from("issues") as unknown as { delete: () => { eq: (c: string, v: unknown) => Promise<{ error: { message: string } | null }> } }).delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
