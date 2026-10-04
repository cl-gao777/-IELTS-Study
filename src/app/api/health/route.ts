export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    { product: "IELTS Studio", status: "ok", instanceRoot: process.cwd() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
