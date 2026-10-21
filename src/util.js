// Piccoli aiuti comuni alle funzioni in api/.
export const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
});
export const fail = (status, error) => json(status, { error });

// corpo JSON della richiesta, o null se non è JSON valido
export async function readJson(request) {
  try { const b = await request.json(); return b && typeof b === 'object' ? b : {}; } catch (e) { return null; }
}
