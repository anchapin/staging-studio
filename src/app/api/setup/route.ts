import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { prisma } from "@/lib/prisma";

type CookieToSet = { name: string; value: string; options: CookieOptions };

export async function GET(request: NextRequest) {
  const cookiesToSet: CookieToSet[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(set: CookieToSet[]) {
          set.forEach((cookie) => {
            request.cookies.set(cookie.name, cookie.value);
            cookiesToSet.push(cookie);
          });
        },
      },
    }
  );

  const respond = (body: Record<string, unknown>, init?: ResponseInit) => {
    const response = NextResponse.json(body, init);
    cookiesToSet.forEach(({ name, value, options }) =>
      response.cookies.set(name, value, options)
    );
    return response;
  };

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return respond({ exists: false }, { status: 401 });
    }

    const userRow = await prisma.user.findUnique({
      where: { email: user.email },
    });

    return respond({ exists: !!userRow });
  } catch {
    return respond({ exists: false }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const cookiesToSet: CookieToSet[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(set: CookieToSet[]) {
          set.forEach((cookie) => {
            request.cookies.set(cookie.name, cookie.value);
            cookiesToSet.push(cookie);
          });
        },
      },
    }
  );

  const respond = (body: Record<string, unknown>, init?: ResponseInit) => {
    const response = NextResponse.json(body, init);
    cookiesToSet.forEach(({ name, value, options }) =>
      response.cookies.set(name, value, options)
    );
    return response;
  };

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return respond({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { firmName, ownerName, logoUrl, psychologyPageContent, signoffContent } = body;

    if (!firmName || !ownerName) {
      return respond(
        { error: "Firm name and owner name are required" },
        { status: 400 }
      );
    }

    const createdUser = await prisma.user.create({
      data: {
        firmName,
        ownerName,
        logoUrl,
        email: user.email,
        psychologyPageContent: psychologyPageContent || null,
        signoffContent: signoffContent || null,
      },
    });

    return respond({ success: true, user: createdUser });
  } catch (error) {
    console.error("Setup error:", error);
    return respond({ error: "Failed to save user setup" }, { status: 500 });
  }
}
