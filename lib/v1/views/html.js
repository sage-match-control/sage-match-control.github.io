// Markup helpers shared by every view.

/** `s` as text safe to place in HTML, including inside an attribute value. */
export function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
