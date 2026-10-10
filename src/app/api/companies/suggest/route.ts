import { NextResponse, type NextRequest } from "next/server";
import { getContextOrNull } from "@/server/auth/current";
import { AppError } from "@/server/errors";
import { suggestCompanies } from "@/modules/customers/queries";

/** Company suggestions while typing a name — prevents duplicate customer records. */
export async function GET(request: NextRequest) {
  const ctx = await getContextOrNull();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  try {
    const suggestions = await suggestCompanies(ctx, request.nextUrl.searchParams.get("q") ?? "");
    return NextResponse.json({ suggestions }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: 403 });
    throw error;
  }
}
