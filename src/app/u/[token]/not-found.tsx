/** Shown with a 404 status when the token doesn't match any unsubscribe link. */
export default function LinkNotFound() {
  return (
    <main className="container narrow withdraw">
      <h1>Link not found</h1>
      <p className="muted">This unsubscribe link isn&apos;t valid. Check that you copied all of it.</p>
    </main>
  );
}
