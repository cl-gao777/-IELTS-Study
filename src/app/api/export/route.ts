import { exportAllData } from "@/server/store";

export async function GET() {
  const payload = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      product: "ISTS — IELTS Study OS",
      data: exportAllData(),
    },
    null,
    2,
  );

  return new Response(payload, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="ists-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}

