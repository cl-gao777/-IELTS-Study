declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfResult {
    text: string;
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    version: string;
  }

  export default function pdf(
    data: Buffer,
    options?: Record<string, unknown>,
  ): Promise<PdfResult>;
}

