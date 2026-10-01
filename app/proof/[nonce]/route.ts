import { proofText } from "@/lib/server/demo";

/** The page the live demo's worker "publishes", for the Proof Engine to find. */
export async function GET(_request: Request, { params }: { params: Promise<{ nonce: string }> }) {
  const { nonce } = await params;
  if (!/^[0-9a-f]{6,16}$/.test(nonce)) return new Response("Not found", { status: 404 });
  const text = proofText(nonce);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${text}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#0b1220;color:#e8edf7;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:32rem;padding:2rem}code{color:#7fb2ff}</style></head>
<body><main><p>This page is a deliverable from Accrue's live demo on Arc.</p><h1>${text}</h1><p>The Proof Engine fetched this page, found the phrase above, and voted on chain.</p><p><a href="/" style="color:#7fb2ff">Back to Accrue</a></p></main></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
