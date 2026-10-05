import { readFile } from "node:fs/promises";

import { getMaterialFile } from "@/server/store";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const material = getMaterialFile(Number(id));
  if (!material?.file_path) {
    return new Response("File not found.", { status: 404 });
  }

  try {
    const bytes = await readFile(material.file_path);
    const activeDocument = /html|svg|xml|javascript/i.test(material.mime_type);
    const headers = { "Content-Type": material.mime_type || "application/octet-stream", "Content-Disposition": `${activeDocument ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(material.file_name)}`, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": material.mime_type === "application/pdf" ? "frame-ancestors 'self'" : "sandbox; default-src 'none'" };
    const range = request.headers.get("range");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${bytes.length}` } });
      const start = match[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match[2]));
      const end = match[1] && match[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
      if (start >= bytes.length || start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${bytes.length}` } });
      return new Response(bytes.subarray(start, end + 1), { status: 206, headers: { ...headers, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${bytes.length}` } });
    }
    return new Response(bytes, {
      headers: { ...headers, "Content-Length": String(bytes.length) },
    });
  } catch {
    return new Response("File not found.", { status: 404 });
  }
}

