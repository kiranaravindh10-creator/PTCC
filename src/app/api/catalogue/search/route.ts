import { NextResponse, type NextRequest } from "next/server";
import { getContextOrNull } from "@/server/auth/current";
import { AppError } from "@/server/errors";
import { searchScope } from "@/modules/catalogue/queries";

/** Searches PTCC's accredited scope (service selector). Optional `branchId` narrows to one branch. */
export async function GET(request: NextRequest) {
  const ctx = await getContextOrNull();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const params = request.nextUrl.searchParams;
  const branchId = params.get("branchId");
  try {
    const result = await searchScope(ctx, {
      query: (params.get("q") ?? "").slice(0, 120),
      branchId: branchId && /^[0-9a-f-]{36}$/i.test(branchId) ? branchId : null,
      limitGroups: 10,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: 403 });
    throw error;
  }
}
