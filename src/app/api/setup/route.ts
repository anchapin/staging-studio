import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return [];
          },
          setAll() {},
        },
      }
    );

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.user) {
      return NextResponse.json({ exists: false }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
    });

    return NextResponse.json({ exists: !!user });
  } catch (error) {
    return NextResponse.json({ exists: false }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return [];
          },
          setAll() {},
        },
      }
    );

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { firmName, ownerName, logoUrl, psychologyPageContent, signoffContent } = body;

    if (!firmName || !ownerName) {
      return NextResponse.json(
        { error: "Firm name and owner name are required" },
        { status: 400 }
      );
    }

    const user = await prisma.user.create({
      data: {
        firmName,
        ownerName,
        logoUrl,
        email: session.user.email,
        psychologyPageContent: psychologyPageContent || null,
        signoffContent: signoffContent || null,
      },
    });

    return NextResponse.json({ success: true, user });
  } catch (error) {
    console.error("Setup error:", error);
    return NextResponse.json(
      { error: "Failed to save user setup" },
      { status: 500 }
    );
  }
}
