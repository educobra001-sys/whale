// Sections the owner keeps hidden until they're published (lessons, exams...). Loaded once when a page starts.
let hidden = new Set();

export async function loadSections(api) {
  try {
    hidden = new Set((await api.appConfig()).hiddenSections || []);
  } catch {
    hidden = new Set();
  }
}

// A section, or a list where any one being open is enough. No key means always open.
export function sectionOn(keys) {
  const list = [].concat(keys ?? []).filter(Boolean);
  return !list.length || list.some((key) => !hidden.has(key));
}
