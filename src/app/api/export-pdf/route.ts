import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { projectId } = await req.json();

    if (!projectId) {
      return NextResponse.json(
        {
          error: "Missing projectId",
          message: "Project ID is required to generate PDF",
        },
        { status: 400 }
      );
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const previewUrl = `${appUrl}/projects/${projectId}/preview`;

    const apiKey = process.env.BROWSERLESS_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          error: "Configuration missing",
          message: "PDF export service is not properly configured. Please contact support.",
        },
        { status: 500 }
      );
    }

    const browserlessUrl = `https://chrome.browserless.io/pdf?token=${apiKey}`;

    const chromeResponse = await fetch(browserlessUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: previewUrl,
        gotoOptions: {
          waitUntil: "networkidle0",
        },
        pdfOptions: {
          printBackground: true,
          format: "A4",
          margin: {
            top: "0",
            right: "0",
            bottom: "0",
            left: "0",
          },
        },
      }),
    });

    if (!chromeResponse.ok) {
      const errorText = await chromeResponse.text();
      console.error("Browserless API error:", chromeResponse.status, errorText);

      if (chromeResponse.status === 401 || chromeResponse.status === 403) {
        return NextResponse.json(
          {
            error: "Authentication failed",
            message: "PDF export service authentication failed. Please contact support.",
          },
          { status: chromeResponse.status }
        );
      }

      if (chromeResponse.status === 429) {
        return NextResponse.json(
          {
            error: "Rate limit exceeded",
            message: "PDF export service is busy. Please wait a moment and try again.",
            retryable: true,
          },
          { status: 429 }
        );
      }

      return NextResponse.json(
        {
          error: "PDF generation failed",
          message: "Unable to generate PDF at this time. Please try again.",
          retryable: true,
        },
        { status: chromeResponse.status }
      );
    }

    const pdfBuffer = await chromeResponse.arrayBuffer();

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="project-${projectId}.pdf"`,
      },
    });
  } catch (error) {
    console.error("PDF export error:", error);

    const errorMessage =
      error instanceof Error ? error.message : "Internal server error";

    if (errorMessage.includes("fetch") || errorMessage.includes("network")) {
      return NextResponse.json(
        {
          error: "Network error",
          message: "Unable to reach the PDF export service. Please check your connection and try again.",
          retryable: true,
        },
        { status: 503 }
      );
    }

    return NextResponse.json(
      {
        error: "PDF export failed",
        message: "An unexpected error occurred while generating the PDF. Please try again.",
        retryable: true,
      },
      { status: 500 }
    );
  }
}
