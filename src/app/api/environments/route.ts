import { NextRequest, NextResponse } from "next/server";
import { supabase, getSupabase } from "@/lib/supabase";
import { environmentSchema, parseOrError } from "@/lib/validation";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { isAllowedImageUrl } from "@/lib/supabase-safe";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0"), 0);

  const { data, error } = await supabase
    .from("environments")
    .select("id, name, description, reference_image_url, created_at")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const res = NextResponse.json({ environments: data, limit, offset });
  res.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  return res;
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = rateLimit(`env:${ip}`, 30, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Rate limited", retryAfterMs: rl.retryAfterMs }, { status: 429 });

  try {
    const body = await req.json();
    const parsed = parseOrError(environmentSchema, body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const { name, description, reference_image_url } = parsed.data;

    if (!isAllowedImageUrl(reference_image_url)) {
      return NextResponse.json({ error: "reference_image_url must be a comic-assets URL from this Supabase project" }, { status: 400 });
    }

    const { data, error } = await (getSupabase().from("environments") as unknown as {
      insert: (v: unknown) => { select: (s: string) => { single: () => Promise<{ data: unknown; error: { message: string } | null }> } };
    })
      .insert({ name: name.trim(), description: description?.trim() || null, reference_image_url })
      .select("id, name, description, reference_image_url, created_at")
      .single();

    if (error || !data) return NextResponse.json({ error: error?.message || "Insert failed" }, { status: 500 });
    return NextResponse.json({ environment: data }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// DELETE /api/environments?id=xxx
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const ip = getClientIp(req);
  const rl = rateLimit(`env-del:${ip}`, 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Rate limited" }, { status: 429 });

  const { error } = await (getSupabase().from("environments") as unknown as { delete: () => { eq: (c: string, v: unknown) => Promise<{ error: { message: string } | null }> } })
    .delete()
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
