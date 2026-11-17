import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";

// GET /api/environments — list all environments
export async function GET() {
  const { data, error } = await supabase
    .from("environments")
    .select("id, name, description, reference_image_url, created_at")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ environments: data });
}

// POST /api/environments — create environment (expects JSON with name, description, reference_image_url)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, description, reference_image_url } = body as {
      name: string;
      description?: string;
      reference_image_url: string;
    };

    if (!name || !reference_image_url) {
      return NextResponse.json({ error: "name and reference_image_url required" }, { status: 400 });
    }

    const { data, error } = await (supabase.from("environments") as unknown as {
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
