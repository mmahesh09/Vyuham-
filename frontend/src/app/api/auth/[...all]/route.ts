import { getAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function handler(request: Request) {
  return (await getAuth()).handler(request);
}

export { handler as GET, handler as POST };
