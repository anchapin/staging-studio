import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { projectId } = await req.json();

    if (!projectId) {
      return NextResponse.json(
        { error: "projectId is required" },
        { status: 400 }
      );
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const previewUrl = `${appUrl}/preview/${projectId}`;

    const apiKey = process.env.BROWSERLESS_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "BROWSERLESS_API_KEY is not configured" },
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
      return NextResponse.json(
        { error: "Failed to generate PDF", details: errorText },
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
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
