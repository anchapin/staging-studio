import { NextRequest, NextResponse } from "next/server";
import { getAuthedPrismaUser } from "@/lib/api-auth";
import {
  DEFAULT_DAILY_EXPORT_LIMIT,
  resolveDailyLimit,
  evaluateDailyQuota,
  getDailyUsage,
} from "@/lib/api-quota";
import {
  exportProjectPdf,
  ExportNotFoundError,
  ExportConfigError,
  ExportAuthError,
  ExportServiceError,
} from "@/lib/api-export-pdf";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const user = await getAuthedPrismaUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = resolveDailyLimit("export", DEFAULT_DAILY_EXPORT_LIMIT);
  const decision = evaluateDailyQuota(await getDailyUsage("export", user.id), limit);
  if (!decision.allowed) {
    return NextResponse.json(
      { error: "Daily export limit reached", remaining: 0, limit, resetsAt: decision.resetsAt },
      { status: 429 }
    );
  }

  const body = await request.json();
  const projectId = body.projectId as string | undefined;
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  try {
    const result = await exportProjectPdf({ userId: user.id, projectId, request });
    return new NextResponse(new Uint8Array(result.pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="lookbook-${projectId}.pdf"`,
        "X-Remaining": String(decision.remaining),
        "X-Limit": String(limit),
      },
    });
  } catch (err) {
    if (err instanceof ExportNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof ExportConfigError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    if (err instanceof ExportAuthError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    if (err instanceof ExportServiceError) {
      return NextResponse.json(
        { error: err.message, retryable: err.retryable },
        { status: 500 }
      );
    }
    console.error(
      JSON.stringify({
        event: "export_pdf_error",
        projectId,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
