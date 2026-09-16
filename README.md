# StagingStudio

AI-assisted home staging lookbook generator for Circle G Designs.

## Tech Stack

- **Next.js 15** (App Router, TypeScript)
- **Tailwind CSS + shadcn/ui**
- **Supabase** (Postgres + Storage + Auth)
- **Prisma** ORM
- **Vercel AI SDK + GPT-4o-mini** — structured copywriting
- **fal.ai FLUX.1 Fill** — AI inpainting
- **Browserless.io** — PDF export

## Getting Started

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Fill in your API keys

# Push Prisma schema to database
npx prisma db push

# Start development server
npm run dev
```

## Development

See [issues](../../issues) for the full development roadmap.
