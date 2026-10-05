// Legacy endpoint kept in place, with no independent claim, send or log path.
// Email operations must go through the protected sito-makai backend.
export function handler(_request: Request): Response {
  return Response.json({ error: 'Usare il gateway Agenda e gli endpoint backend comunicazioni.' }, {
    status: 410, headers: { 'Cache-Control': 'no-store' },
  });
}

if (import.meta.main) Deno.serve(handler);
