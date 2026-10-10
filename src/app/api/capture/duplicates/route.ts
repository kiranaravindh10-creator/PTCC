import { NextResponse, type NextRequest } from "next/server";
import { getContextOrNull } from "@/server/auth/current";
import { errorResponse } from "@/server/http";
import { findCaptureDuplicates } from "@/modules/leads/capture-service";

/** Possible duplicates for the capture review: only what this person may see. */
export async function GET(request: NextRequest) {
  const ctx = await getContextOrNull();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const params = request.nextUrl.searchParams;
  try {
    const result = await findCaptureDuplicates(ctx, {
      companyName: params.get("companyName") ?? undefined,
      phone: params.get("phone") ?? undefined,
      email: params.get("email") ?? undefined,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
